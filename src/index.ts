import { run as runBenchmark, type ModelAdapter, type RunOptions, type Trace } from "benchmark-core";
import { benchmark } from "./benchmark.js";
export { benchmark };
export const run = (adapter: ModelAdapter, options?: RunOptions) => runBenchmark(benchmark, adapter, options);
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
