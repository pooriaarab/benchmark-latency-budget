import type { Environment, EnvironmentStart, JsonValue, Task, ToolResult, ToolSpec } from "benchmark-core";

/** Flat charge for a describe_tools call; kept cheap so cost discovery is viable inside a deadline. */
export const DESCRIBE_TOOLS_MS = 25;
export type ClockMode = "measured" | "declared";

export const LATENCY_TOOLS: ToolSpec[] = [
  {
    name: "lookup", description: "Look up a person in the team directory by full name. Returns their phone extension and room.",
    parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"], additionalProperties: false },
  },
  {
    name: "calendar_get", description: "List the events on one date (YYYY-MM-DD). Returns event names, rooms, and organizers.",
    parameters: { type: "object", properties: { date: { type: "string" } }, required: ["date"], additionalProperties: false },
  },
  {
    name: "search_docs", description: "Search internal docs by topic keyword. Returns matching titles, topics, and authors.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "describe_tools", description: "Read-only: report the scheduled virtual latency in milliseconds of every tool, including this call.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];

interface DirectoryEntry { extension: string; room: string }
interface CalendarEvent { event: string; room: string; organizer: string; topic?: string }
interface DocEntry { title: string; topic: string; author: string; event?: string; date?: string }
interface Fixtures { directory?: Record<string, DirectoryEntry>; calendar?: Record<string, CalendarEvent[]>; docs?: DocEntry[] }

function metaOf(task: Task): Record<string, JsonValue> {
  return (task.metadata ?? {}) as Record<string, JsonValue>;
}
function fixturesOf(task: Task): Fixtures {
  return (metaOf(task).fixtures ?? {}) as Fixtures;
}
function scheduleOf(task: Task): Record<string, number> {
  const raw = metaOf(task)["latencyMs"];
  const schedule: Record<string, number> = {};
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) if (typeof value === "number") schedule[key] = value;
  }
  return schedule;
}

/**
 * Seeded service simulator. Every tool call costs virtual time from the task
 * schedule. The environment also stamps the wall-clock gap before each tool
 * call and before the final answer, so the grader can bill real model turn
 * time; `clock: "declared"` (constructor option or the
 * LATENCY_BUDGET_CLOCK=declared environment variable) marks the trace so the
 * grader bills declared thinkMs per turn instead.
 */
export class LatencyBudgetEnvironment implements Environment {
  #task: Task | undefined;
  #clock: ClockMode;
  #lastMark = 0;
  #gaps: number[] = [];

  constructor(options?: { clock?: ClockMode }) {
    this.#clock = options?.clock ?? (process.env.LATENCY_BUDGET_CLOCK === "declared" ? "declared" : "measured");
  }

  reset(task: Task, _seed: number): EnvironmentStart {
    this.#task = task;
    this.#gaps = [];
    this.#lastMark = performance.now();
    const meta = metaOf(task);
    const deadlineMs = typeof meta["deadlineMs"] === "number" ? meta["deadlineMs"] : 0;
    const cls = typeof meta["budgetClass"] === "string" ? meta["budgetClass"] : "standard";
    return {
      system: `Answer the user's question with the lookup, calendar_get, and search_docs tools. This is a ${cls} task: keep the total budgeted time under ${deadlineMs}ms. Call describe_tools to see what each tool costs. When you know the answer, reply with the value only: no explanation, units, or extra words.`,
      tools: LATENCY_TOOLS,
    };
  }
  #mark(): void {
    const now = performance.now();
    this.#gaps.push(Math.round((now - this.#lastMark) * 1000) / 1000);
    this.#lastMark = now;
  }
  callTool(name: string, args: Record<string, JsonValue>): ToolResult {
    this.#mark();
    const task = this.#task;
    const fixtures = task === undefined ? {} : fixturesOf(task);
    const callArgs: Record<string, JsonValue> = args !== null && typeof args === "object" ? args : {};
    if (name === "describe_tools") {
      const schedule = task === undefined ? {} : scheduleOf(task);
      return { result: { tools: [...LATENCY_TOOLS.filter((tool) => tool.name !== "describe_tools").map((tool) => ({ name: tool.name, description: tool.description, latencyMs: schedule[tool.name] ?? null })), { name: "describe_tools", description: "This call.", latencyMs: DESCRIBE_TOOLS_MS }] } };
    }
    if (name === "lookup") {
      const key = String(callArgs["key"] ?? "");
      const entry = fixtures.directory?.[key];
      if (entry === undefined) return { result: null, error: { code: "NOT_FOUND", message: `No directory entry for ${key}.` } };
      return { result: { key, extension: entry.extension, room: entry.room } };
    }
    if (name === "calendar_get") {
      const date = String(callArgs["date"] ?? "");
      const events = fixtures.calendar?.[date];
      if (events === undefined) return { result: null, error: { code: "NOT_FOUND", message: `No calendar data for ${date}.` } };
      return { result: { date, events } };
    }
    if (name === "search_docs") {
      const query = String(callArgs["query"] ?? "").toLowerCase();
      const words = query.split(/\s+/).filter((w) => w.length > 0);
      if (words.length === 0) return { result: { results: [] } };
      const docs = fixtures.docs ?? [];
      const results = docs.filter((doc) => {
        const hay = `${doc.title} ${doc.topic}`.toLowerCase();
        return hay.includes(query) || words.some((w) => hay.includes(w));
      });
      return { result: { results } };
    }
    return { result: null, error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` } };
  }
  state(): unknown {
    if (this.#task !== undefined) this.#mark();
    return { taskId: this.#task?.id, clock: this.#clock, turnTimesMs: [...this.#gaps] };
  }
  done(): boolean {
    return false;
  }
}
