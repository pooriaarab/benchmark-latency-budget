import type { JsonValue, Task, TaskScore, ToolLogEntry, Trace } from "benchmark-core";
import { LatencyBudgetEnvironment } from "./simulator.js";

export const UNKNOWN_TOOL_MS = 150;
export const CURVE_FACTORS = [0.5, 1, 2, 4];

export interface MinimalCall { name: string; args: Record<string, JsonValue> }
export interface LatencyMeta {
  budgetClass: string; deadlineMs: number; thinkMs: number;
  latencyMs: Record<string, number>; minimalCalls: MinimalCall[];
}

export function latencyMeta(task: Task): LatencyMeta {
  const meta = (task.metadata ?? {}) as Record<string, JsonValue>;
  const latencyMs: Record<string, number> = {};
  const rawSchedule = meta["latencyMs"];
  if (rawSchedule !== null && typeof rawSchedule === "object" && !Array.isArray(rawSchedule)) {
    for (const [key, value] of Object.entries(rawSchedule)) {
      if (typeof value === "number") latencyMs[key] = value;
    }
  }
  const minimalCalls: MinimalCall[] = [];
  if (Array.isArray(meta["minimalCalls"])) {
    for (const item of meta["minimalCalls"]) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const entry = item as Record<string, JsonValue>;
        if (typeof entry["name"] === "string" && entry["args"] !== null && typeof entry["args"] === "object") {
          minimalCalls.push({ name: entry["name"] as string, args: entry["args"] as Record<string, JsonValue> });
        }
      }
    }
  }
  const deadline = meta["deadlineMs"];
  const think = meta["thinkMs"];
  return {
    budgetClass: typeof meta["budgetClass"] === "string" ? (meta["budgetClass"] as string) : "unknown",
    deadlineMs: typeof deadline === "number" ? deadline : 0,
    thinkMs: typeof think === "number" ? think : 0,
    latencyMs, minimalCalls,
  };
}

export function normalizeAnswer(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Virtual total: declared model turn time plus one scheduled charge per recorded call. */
export function totalTimeMs(task: Task, toolLog: readonly ToolLogEntry[]): number {
  const meta = latencyMeta(task);
  let total = meta.thinkMs;
  for (const entry of toolLog) total += meta.latencyMs[entry.name] ?? UNKNOWN_TOOL_MS;
  return total;
}

/** True when a successful re-derived tool result contains the expected answer. */
export function evidenceFound(task: Task, toolLog: readonly ToolLogEntry[], seed = 1): boolean {
  const want = normalizeAnswer(task.expected);
  if (want === "") return false;
  const env = new LatencyBudgetEnvironment();
  env.reset(task, seed);
  for (const entry of toolLog) {
    const outcome = env.callTool(entry.name, entry.args);
    if (outcome.error !== undefined) continue;
    if (JSON.stringify(outcome.result ?? null).toLowerCase().includes(want)) return true;
  }
  return false;
}

export function isCorrect(task: Task, submission: Trace, seed = 1): boolean {
  if (normalizeAnswer(submission.answer) === "") return false;
  return normalizeAnswer(submission.answer) === normalizeAnswer(task.expected)
    && evidenceFound(task, submission.toolLog ?? [], seed);
}

/** qualityWithinBudget: 1 only for a grounded correct answer inside the deadline. */
export function gradeLatency(task: Task, submission: Trace, seed = 1): TaskScore {
  const meta = latencyMeta(task);
  const toolLog = submission.toolLog ?? [];
  const total = totalTimeMs(task, toolLog);
  const details = { budgetClass: meta.budgetClass, deadlineMs: meta.deadlineMs, totalTimeMs: total, toolCalls: toolLog.length, evidenceFound: evidenceFound(task, toolLog, seed), lateButCorrect: false };
  if (normalizeAnswer(submission.answer) === "") {
    return { score: 0, reason: "No answer was submitted.", details: details as unknown as JsonValue };
  }
  if (normalizeAnswer(submission.answer) !== normalizeAnswer(task.expected)) {
    return { score: 0, reason: `Incorrect answer in ${total}ms against a ${meta.deadlineMs}ms deadline.`, details: details as unknown as JsonValue };
  }
  if (!details.evidenceFound) {
    return { score: 0, reason: "Correct text but no tool output contains it, so the answer is not grounded.", details: details as unknown as JsonValue };
  }
  if (total <= meta.deadlineMs) {
    return { score: 1, reason: `Correct answer in ${total}ms, within the ${meta.deadlineMs}ms deadline.`, details: details as unknown as JsonValue };
  }
  const late = { ...details, lateButCorrect: true };
  return { score: 0, reason: `Correct answer but ${total}ms exceeded the ${meta.deadlineMs}ms deadline (late but correct).`, details: late as unknown as JsonValue };
}

export interface CurvePoint { factor: number; deadlineMs: number; score: number }

/** Score of one fixed trace as the deadline is swept from 0.5x to 4x. */
export function sweepDeadlines(task: Task, submission: Trace, factors: readonly number[] = CURVE_FACTORS, seed = 1): CurvePoint[] {
  const meta = latencyMeta(task);
  const correct = isCorrect(task, submission, seed);
  const total = totalTimeMs(task, submission.toolLog ?? []);
  return factors.map((factor) => {
    const deadlineMs = Math.round(meta.deadlineMs * factor);
    return { factor, deadlineMs, score: correct && total <= deadlineMs ? 1 : 0 };
  });
}

export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const rank = q * (sorted.length - 1);
  const low = Math.floor(rank); const high = Math.ceil(rank);
  return sorted[low] === undefined || sorted[high] === undefined ? 0 : sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

export interface TimeSummary { count: number; p50: number; p95: number; lateButCorrect: number; mean: number }

export function summarizeTimes(entries: Array<{ totalTimeMs: number; correct: boolean; onTime: boolean; score: number }>): TimeSummary {
  const totals = entries.map((e) => e.totalTimeMs).sort((a, b) => a - b);
  return {
    count: entries.length,
    p50: percentile(totals, 0.5), p95: percentile(totals, 0.95),
    lateButCorrect: entries.filter((e) => e.correct && !e.onTime).length,
    mean: entries.length === 0 ? 0 : entries.reduce((sum, e) => sum + e.score, 0) / entries.length,
  };
}
