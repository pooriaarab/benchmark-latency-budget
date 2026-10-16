import type { Environment, EnvironmentStart, JsonValue, Task, ToolResult, ToolSpec } from "benchmark-core";

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
];

interface DirectoryEntry { extension: string; room: string }
interface CalendarEvent { event: string; room: string; organizer: string; topic?: string }
interface DocEntry { title: string; topic: string; author: string; event?: string; date?: string }
interface Fixtures { directory?: Record<string, DirectoryEntry>; calendar?: Record<string, CalendarEvent[]>; docs?: DocEntry[] }

function fixturesOf(task: Task): Fixtures {
  const meta = (task.metadata ?? {}) as Record<string, JsonValue>;
  return (meta.fixtures ?? {}) as Fixtures;
}

/** Seeded service simulator. Every tool call costs virtual time from the task schedule. */
export class LatencyBudgetEnvironment implements Environment {
  #task: Task | undefined;
  reset(task: Task, _seed: number): EnvironmentStart {
    this.#task = task;
    return {
      system: "Answer the user's question with the lookup, calendar_get, and search_docs tools. When you know the answer, reply with no more tool calls and put the final answer in your message.",
      tools: LATENCY_TOOLS,
    };
  }
  callTool(name: string, args: Record<string, JsonValue>): ToolResult {
    const fixtures = this.#task === undefined ? {} : fixturesOf(this.#task);
    if (name === "lookup") {
      const key = String(args["key"] ?? "");
      const entry = fixtures.directory?.[key];
      if (entry === undefined) return { result: null, error: { code: "NOT_FOUND", message: `No directory entry for ${key}.` } };
      return { result: { key, extension: entry.extension, room: entry.room } };
    }
    if (name === "calendar_get") {
      const date = String(args["date"] ?? "");
      const events = fixtures.calendar?.[date];
      if (events === undefined) return { result: null, error: { code: "NOT_FOUND", message: `No calendar data for ${date}.` } };
      return { result: { date, events } };
    }
    if (name === "search_docs") {
      const query = String(args["query"] ?? "").toLowerCase();
      const words = query.split(/\s+/).filter((w) => w.length > 0);
      const docs = fixtures.docs ?? [];
      const results = docs.filter((doc) => {
        const hay = `${doc.title} ${doc.topic}`.toLowerCase();
        return hay.includes(query) || words.some((w) => hay.includes(w));
      });
      return { result: { query: args["query"] ?? "", results } };
    }
    return { result: null, error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` } };
  }
  state(): unknown {
    return { taskId: this.#task?.id };
  }
  done(): boolean {
    return false;
  }
}
