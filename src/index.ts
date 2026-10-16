import { run as runBenchmark, type Benchmark, type ModelAdapter, type RunOptions, type RunReport, type Task, type Trace } from "benchmark-core";
import { benchmark, createLatencyBenchmark, loadTasksFrom } from "./benchmark.js";
import { CURVE_FACTORS, isCorrect, latencyMeta, percentile, timeBreakdown } from "./latency.js";

export { benchmark, createLatencyBenchmark, loadTasksFrom };
export type { LatencyBenchmarkOptions } from "./benchmark.js";

export interface LatencySummary {
  /** Rows with a submission that could be timed. */
  rows: number;
  p50Ms: number;
  p95Ms: number;
  lateButCorrect: number;
  clocks: { measured: number; declared: number };
  /** Mean qualityWithinBudget as deadlines sweep 0.5x to 4x. */
  deadlineCurve: Array<{ factor: number; meanScore: number }>;
}

export interface LatencyRunReport extends RunReport {
  latency: LatencySummary;
}

/** Attach the latency summary (p50/p95, lateButCorrect, deadline curve) to a run report. */
export async function latencyReport(report: RunReport, source: Benchmark | readonly Task[] = benchmark): Promise<LatencyRunReport> {
  const tasks = "listTasks" in source ? await source.listTasks() : source;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const entries: Array<{ totalMs: number; deadlineMs: number; correct: boolean; clock: "measured" | "declared" }> = [];
  for (const row of report.rows) {
    const task = byId.get(row.taskId);
    if (task === undefined || row.submission === undefined) continue;
    const time = timeBreakdown(task, row.submission);
    entries.push({
      totalMs: time.totalMs, deadlineMs: latencyMeta(task).deadlineMs,
      correct: isCorrect(task, row.submission), clock: time.clock,
    });
  }
  const totals = entries.map((entry) => entry.totalMs).sort((a, b) => a - b);
  const latency: LatencySummary = {
    rows: entries.length,
    p50Ms: percentile(totals, 0.5),
    p95Ms: percentile(totals, 0.95),
    lateButCorrect: entries.filter((entry) => entry.correct && entry.totalMs > entry.deadlineMs).length,
    clocks: {
      measured: entries.filter((entry) => entry.clock === "measured").length,
      declared: entries.filter((entry) => entry.clock === "declared").length,
    },
    deadlineCurve: CURVE_FACTORS.map((factor) => ({
      factor,
      meanScore: entries.length === 0 ? 0 : entries.reduce((sum, entry) => sum + (entry.correct && entry.totalMs <= Math.round(entry.deadlineMs * factor) ? 1 : 0), 0) / entries.length,
    })),
  };
  return { ...report, latency };
}

/** Run every task and return the report plus the latency summary. */
export const run = (adapter: ModelAdapter, options?: RunOptions) =>
  runBenchmark(benchmark, adapter, options).then((report) => latencyReport(report, benchmark));

export async function score(taskId: string, submission: Trace) {
  const task = await benchmark.getTask(taskId); if (!task) throw new Error(`Task not found: ${taskId}`);
  return benchmark.score(task, submission);
}
export { DESCRIBE_TOOLS_MS, LatencyBudgetEnvironment, LATENCY_TOOLS } from "./simulator.js";
export type { ClockMode } from "./simulator.js";
export {
  CURVE_FACTORS, UNKNOWN_TOOL_MS, answerCandidates, candidateValues, evidenceFound, gradeLatency, isCorrect,
  latencyMeta, mentionsValue, normalizeAnswer, percentile, summarizeTimes, sweepDeadlines, timeBreakdown, totalTimeMs,
} from "./latency.js";
export type { CurvePoint, LatencyMeta, MinimalCall, TimeBreakdown, TimeSummary } from "./latency.js";
