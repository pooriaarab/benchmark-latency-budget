import { readFile } from "node:fs/promises";
import { defineBenchmark, type Task } from "benchmark-core";
import { gradeLatency, latencyMeta } from "./latency.js";
import { LatencyBudgetEnvironment, type ClockMode } from "./simulator.js";

export interface LatencyBenchmarkOptions {
  /** Path to a tasks.jsonl file; defaults to the packaged public set. */
  tasksPath?: string;
  /** Clock mode for episodes; defaults to measured, or declared via LATENCY_BUDGET_CLOCK=declared. */
  clock?: ClockMode;
}

const DEFAULT_TASKS_URL = new URL("../data/tasks.jsonl", import.meta.url);

export async function loadTasksFrom(tasksPath?: string): Promise<Task[]> {
  const text = await readFile(tasksPath ?? DEFAULT_TASKS_URL, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line) as Task);
}

export function createLatencyBenchmark(options: LatencyBenchmarkOptions = {}) {
  return defineBenchmark({
    id: "benchmark-latency-budget", name: "Latency Budget", tagline: "Quality that only counts if it arrives before the deadline.", tags: ["helpful"], category: "agents",
    whatItMeasures: "Whether an agent gives the right answer before a voice (700ms), UI (2s), or background (10s) deadline, with virtual per-tool latencies.", version: "0.1.0", status: "alpha",
    loadTasks: () => loadTasksFrom(options.tasksPath),
    grade(task, submission, context) {
      return gradeLatency(task, submission, context.seed);
    },
    environment: () => new LatencyBudgetEnvironment(options.clock === undefined ? {} : { clock: options.clock }),
    mockPolicies: {
      good: (task) => [
        ...latencyMeta(task).minimalCalls.map((call) => ({ toolCalls: [{ name: call.name, args: call.args }] })),
        { content: typeof task.expected === "string" ? task.expected : JSON.stringify(task.expected ?? "") },
      ],
      bad: () => [{ content: "yes" }],
    },
    provenance: [{
      name: "Seeded latency-budget task generator", kind: "synthetic", url: "https://github.com/pooriaarab/benchmark-latency-budget/blob/main/scripts/gen-tasks.mjs",
      licence: "MIT", howToGet: "Run `node scripts/gen-tasks.mjs --seed 20261015` for the public tasks, or `node scripts/gen-tasks.mjs --seed <n> --split hidden` for a hidden split (written to gitignored artifacts/ with h- prefixed task ids).", retrievedAt: "2026-10-15T00:00:00.000Z",
      contaminationNotes: "Public tasks generated with seed 20261015, benchmark cutoff 2026-10-15. Public tasks may enter training data; use a separately seeded hidden split for final comparisons.",
      refresh: "Pick a new seed, run the generator, review the JSONL diff. Regenerate quarterly or when saturation is shown.",
    }],
    gradingMethod: "qualityWithinBudget: a single named candidate value (bounded, case-insensitive) grounded in replayed tool output, scored 1 only when total time (measured or declared per-turn model time plus scheduled tool latencies) is within the task deadline. Reports p50/p95 time, lateButCorrect count, and a 0.5x-4x deadline curve.",
  });
}

export const benchmark = createLatencyBenchmark();
