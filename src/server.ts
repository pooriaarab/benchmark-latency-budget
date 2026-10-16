import type { JsonValue, Task, Trace } from "benchmark-core";
import { isCorrect, latencyMeta, timeBreakdown } from "./latency.js";

/**
 * A caller-submitted trace cannot prove its wall-clock turn times, so server
 * surfaces (`/v1/score`, MCP `score_answer`) strip a self-reported
 * `clock: "measured"` state and bill declared `thinkMs` per turn instead.
 * Local `run` episodes keep the environment's own measured record.
 */
export function serverSubmission(submission: Trace): Trace {
  const state = submission.finalState;
  if (state === null || typeof state !== "object" || Array.isArray(state)) return submission;
  const record = { ...(state as Record<string, JsonValue>) };
  if (record["clock"] !== "measured") return submission;
  delete record["clock"];
  delete record["turnTimesMs"];
  return { ...submission, finalState: record };
}

export interface SubmissionLatency {
  deadlineMs: number;
  totalTimeMs: number;
  modelMs: number;
  toolMs: number;
  modelTurns: number;
  clock: "measured" | "declared";
  onTime: boolean;
  lateButCorrect: boolean;
}

/** Timing block for one scored submission, as returned by server surfaces. */
export function submissionLatency(task: Task, submission: Trace, seed = 1): SubmissionLatency {
  const meta = latencyMeta(task);
  const time = timeBreakdown(task, submission);
  const onTime = time.totalMs <= meta.deadlineMs;
  return {
    deadlineMs: meta.deadlineMs,
    totalTimeMs: time.totalMs,
    modelMs: time.modelMs,
    toolMs: time.toolMs,
    modelTurns: time.turns,
    clock: time.clock,
    onTime,
    lateButCorrect: isCorrect(task, submission, seed) && !onTime,
  };
}
