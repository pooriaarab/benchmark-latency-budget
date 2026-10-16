import { readFile } from "node:fs/promises";
import { defineBenchmark, exactMatch, replay, type Environment, type JsonValue, type Task, type ToolResult } from "benchmark-core";

async function loadTasks(): Promise<Task[]> {
  const text = await readFile(new URL("../data/tasks.jsonl", import.meta.url), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Task);
}
class StarterEnvironment implements Environment {
  #finished = false;
  reset() {
    this.#finished = false;
    return { system: "Call finish_task once, then stop.", tools: [{ name: "finish_task", description: "Mark the task finished.", parameters: { type: "object" as const, properties: {}, additionalProperties: false } }] };
  }
  callTool(name: string, _args: Record<string, JsonValue>): ToolResult {
    if (name !== "finish_task") return { result: null, error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` } };
    this.#finished = true; return { result: { finished: true } };
  }
  state() { return { finished: this.#finished }; }
  done() { return this.#finished; }
}
export const benchmark = defineBenchmark({
  id: "benchmark-latency-budget", name: "Latency Budget", tagline: "Quality that only counts if it arrives before the deadline.", tags: ["helpful"], category: "agents",
  whatItMeasures: "Quality that only counts if it arrives before the deadline.", version: "0.1.0", status: "alpha", loadTasks,
  async grade(task, submission, context) {
    if (task.kind === "single") return submission.answer === undefined ? { score: 0, reason: "Submission has no answer." } : exactMatch(task.expected ?? null, submission.answer);
    const state = await replay(new StarterEnvironment(), task, submission.toolLog ?? [], context.seed) as { finished?: boolean };
    return state.finished ? { score: 1, reason: "The trace finished the task." } : { score: 0, reason: "The trace did not finish the task." };
  },
  environment: () => new StarterEnvironment(),
  mockPolicies: {
    good: (task) => task.kind === "episode" ? [{ toolCalls: [{ name: "finish_task", args: {} }] }] : [],
    bad: (task) => task.kind === "episode" ? [{ content: "Skipped the tool." }] : [],
  },
  provenance: [{
    name: "Seeded latency-budget task generator", kind: "synthetic", url: "https://github.com/pooriaarab/benchmark-latency-budget/blob/main/scripts/gen-tasks.mjs",
    licence: "MIT", howToGet: "Run `node scripts/gen-tasks.mjs --seed 20261015` for the public tasks, or `node scripts/gen-tasks.mjs --seed <n> --split hidden` for a hidden split (written to gitignored artifacts/).", retrievedAt: "2026-10-16T00:00:00.000Z",
    contaminationNotes: "Public tasks generated with seed 20261015, benchmark cutoff 2026-10-16. Public tasks may enter training data; use a separately seeded hidden split for final comparisons.",
    refresh: "Pick a new seed, run the generator, review the JSONL diff. Regenerate quarterly or when saturation is shown.",
  }],
  gradingMethod: "qualityWithinBudget: exact answer (trimmed, case-insensitive) grounded in tool output, scored 1 only when total virtual time (thinkMs plus scheduled tool latencies) is within the task deadline. Reports p50/p95 time, lateButCorrect count, and a 0.5x-4x deadline curve.",
});
