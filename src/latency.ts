import type { JsonValue, Task, TaskScore, ToolLogEntry, Trace } from "benchmark-core";
import { DESCRIBE_TOOLS_MS, LatencyBudgetEnvironment } from "./simulator.js";

export const UNKNOWN_TOOL_MS = 150;
export const CURVE_FACTORS = [0.5, 1, 2, 4];

export interface MinimalCall { name: string; args: Record<string, JsonValue> }
export interface LatencyMeta {
  budgetClass: string; deadlineMs: number; thinkMs: number;
  latencyMs: Record<string, number>; minimalCalls: MinimalCall[];
  candidates: string[];
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
  const candidates: string[] = [];
  if (Array.isArray(meta["candidates"])) {
    for (const item of meta["candidates"]) if (typeof item === "string" && item.trim() !== "") candidates.push(item);
  }
  const deadline = meta["deadlineMs"];
  const think = meta["thinkMs"];
  return {
    budgetClass: typeof meta["budgetClass"] === "string" ? (meta["budgetClass"] as string) : "unknown",
    deadlineMs: typeof deadline === "number" ? deadline : 0,
    thinkMs: typeof think === "number" ? think : 0,
    latencyMs, minimalCalls, candidates,
  };
}

export function normalizeAnswer(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-bounded, case-insensitive test for one candidate value inside an
 * answer. Internal whitespace in the candidate collapses to \s+, so
 * `Expensing travel  the simple way` still matches. `Room 3B` matches `3b`.
 */
export function mentionsValue(answer: string, candidate: string): boolean {
  const pattern = candidate.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
  if (pattern === "") return false;
  return new RegExp(`(?<![A-Za-z0-9])${pattern}(?![A-Za-z0-9])`, "i").test(answer);
}

/** Distinct candidate values named in the answer, in candidate order. */
export function answerCandidates(answer: unknown, candidates: readonly string[]): string[] {
  const text = String(answer ?? "");
  const seen = new Set<string>();
  const found: string[] = [];
  for (const candidate of candidates) {
    const key = normalizeAnswer(candidate);
    if (key === "" || seen.has(key)) continue;
    if (mentionsValue(text, candidate)) { seen.add(key); found.push(candidate); }
  }
  return found;
}

/** Candidate list for a task; falls back to the expected value alone when metadata is absent. */
export function candidateValues(task: Task): string[] {
  const meta = latencyMeta(task);
  const want = String(task.expected ?? "");
  return meta.candidates.length > 0 ? meta.candidates : want.trim() === "" ? [] : [want];
}

interface ClockState { clock?: unknown; turnTimesMs?: unknown }

function measuredTurnTimes(submission: Trace): number[] | undefined {
  const state = submission.finalState;
  if (state === null || typeof state !== "object" || Array.isArray(state)) return undefined;
  const record = state as ClockState;
  if (record.clock !== "measured" || !Array.isArray(record.turnTimesMs)) return undefined;
  const times: number[] = [];
  for (const value of record.turnTimesMs) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
    times.push(value);
  }
  return times;
}

export interface TimeBreakdown {
  totalMs: number; modelMs: number; toolMs: number; turns: number;
  clock: "measured" | "declared";
}

/**
 * Virtual total: model turn time plus one scheduled charge per recorded call.
 * Model time is the measured wall-clock gaps the environment recorded for the
 * episode (`clock: "measured"`), or the declared `thinkMs` billed per model
 * turn. A flat tool log cannot show where turns broke, so declared mode bills
 * one turn per recorded call plus one for the final answer; batched calls are
 * billed as separate turns. `describe_tools` costs a flat 25 ms and unknown
 * tools cost 150 ms.
 */
export function timeBreakdown(task: Task, submission: Trace | readonly ToolLogEntry[]): TimeBreakdown {
  const meta = latencyMeta(task);
  const trace: Trace = Array.isArray(submission) ? { toolLog: submission as ToolLogEntry[] } : (submission as Trace);
  const toolLog = trace.toolLog ?? [];
  let toolMs = 0;
  for (const raw of toolLog) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const name = (raw as { name?: unknown }).name;
    if (name === "describe_tools") { toolMs += DESCRIBE_TOOLS_MS; continue; }
    toolMs += (typeof name === "string" ? meta.latencyMs[name] : undefined) ?? UNKNOWN_TOOL_MS;
  }
  const measured = measuredTurnTimes(trace);
  if (measured !== undefined) {
    const modelMs = measured.reduce((sum, value) => sum + value, 0);
    return { totalMs: Math.round(modelMs + toolMs), modelMs: Math.round(modelMs), toolMs, turns: measured.length, clock: "measured" };
  }
  const turns = toolLog.length + 1;
  const modelMs = meta.thinkMs * turns;
  return { totalMs: modelMs + toolMs, modelMs, toolMs, turns, clock: "declared" };
}

/** Virtual total in milliseconds for a trace (or a bare tool log). */
export function totalTimeMs(task: Task, submission: Trace | readonly ToolLogEntry[]): number {
  return timeBreakdown(task, submission).totalMs;
}

function entryArgs(entry: ToolLogEntry): Record<string, JsonValue> {
  const args: unknown = (entry as { args?: unknown }).args;
  return args !== null && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, JsonValue>) : {};
}

/**
 * True when a successful re-derived tool result contains the expected answer.
 * A match is ignored when the call's own arguments already contain the
 * answer, so feeding the answer back as a query is not evidence.
 * `describe_tools` returns the latency schedule, never task evidence, so it
 * is skipped too.
 */
export function evidenceFound(task: Task, toolLog: readonly ToolLogEntry[], seed = 1): boolean {
  const want = normalizeAnswer(task.expected);
  if (want === "") return false;
  const env = new LatencyBudgetEnvironment();
  env.reset(task, seed);
  for (const raw of toolLog) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as ToolLogEntry;
    const name = typeof entry.name === "string" ? entry.name : "";
    if (name === "describe_tools") continue;
    const args = entryArgs(entry);
    if (JSON.stringify(args).toLowerCase().includes(want)) continue;
    const outcome = env.callTool(name, args);
    if (outcome.error !== undefined) continue;
    if (JSON.stringify(outcome.result ?? null).toLowerCase().includes(want)) return true;
  }
  return false;
}

/**
 * A submission is correct when it names exactly one candidate value and that
 * value is the expected one, and a replayed tool result grounds it. Naming two
 * or more candidates (a gamed answer that lists every option) is incorrect.
 */
export function isCorrect(task: Task, submission: Trace, seed = 1): boolean {
  const want = normalizeAnswer(task.expected);
  if (want === "" || normalizeAnswer(submission.answer) === "") return false;
  const found = answerCandidates(submission.answer, candidateValues(task));
  if (found.length !== 1 || normalizeAnswer(found[0]) !== want) return false;
  return evidenceFound(task, submission.toolLog ?? [], seed);
}

/** qualityWithinBudget: 1 only for a grounded correct answer inside the deadline. */
export function gradeLatency(task: Task, submission: Trace, seed = 1): TaskScore {
  const meta = latencyMeta(task);
  const toolLog = submission.toolLog ?? [];
  const time = timeBreakdown(task, submission);
  const found = answerCandidates(submission.answer, candidateValues(task));
  const want = normalizeAnswer(task.expected);
  const details = {
    budgetClass: meta.budgetClass, deadlineMs: meta.deadlineMs, totalTimeMs: time.totalMs,
    modelMs: time.modelMs, toolMs: time.toolMs, modelTurns: time.turns, clock: time.clock,
    toolCalls: toolLog.length, namedCandidates: found,
    evidenceFound: evidenceFound(task, toolLog, seed), lateButCorrect: false,
    deadlineCurve: sweepDeadlines(task, submission, CURVE_FACTORS, seed),
  };
  const fail = (reason: string) => ({ score: 0, reason, details: details as unknown as JsonValue });
  if (normalizeAnswer(submission.answer) === "") {
    return fail("No answer was submitted.");
  }
  if (found.length === 0) {
    return fail(`No candidate value found in the answer; ${time.totalMs}ms against a ${meta.deadlineMs}ms deadline.`);
  }
  if (found.length > 1) {
    return fail(`Answer names ${found.length} candidate values (${found.join(", ")}); pick one value only.`);
  }
  if (normalizeAnswer(found[0]) !== want) {
    return fail(`Incorrect answer in ${time.totalMs}ms against a ${meta.deadlineMs}ms deadline.`);
  }
  if (!details.evidenceFound) {
    return fail("Correct text but no tool output contains it, so the answer is not grounded.");
  }
  if (time.totalMs <= meta.deadlineMs) {
    return { score: 1, reason: `Correct answer in ${time.totalMs}ms, within the ${meta.deadlineMs}ms deadline.`, details: details as unknown as JsonValue };
  }
  const late = { ...details, lateButCorrect: true };
  return { score: 0, reason: `Correct answer but ${time.totalMs}ms exceeded the ${meta.deadlineMs}ms deadline (late but correct).`, details: late as unknown as JsonValue };
}

export interface CurvePoint { factor: number; deadlineMs: number; score: number }

/** Score of one fixed trace as the deadline is swept from 0.5x to 4x. */
export function sweepDeadlines(task: Task, submission: Trace, factors: readonly number[] = CURVE_FACTORS, seed = 1): CurvePoint[] {
  const meta = latencyMeta(task);
  const correct = isCorrect(task, submission, seed);
  const total = totalTimeMs(task, submission);
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
