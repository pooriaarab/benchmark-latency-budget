import { createHandler, type Benchmark, type JsonValue, type Task, type Trace } from "benchmark-core";
import { benchmark } from "./benchmark.js";
import { serverSubmission, submissionLatency } from "./server.js";

/**
 * Fetch-style handler over the core routes. For `POST /v1/score` the
 * submission's self-reported measured clock is stripped before grading (a
 * caller cannot prove its wall-clock turn times) and the response gains a
 * `latency` timing block: deadlineMs, totalTimeMs, modelMs, toolMs,
 * modelTurns, clock, onTime, lateButCorrect.
 */
export function createApi(bench: Benchmark<Task> = benchmark) {
  const inner = createHandler(bench);
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/score") return inner(request);
    let payload: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = await request.clone().json();
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch {
      payload = undefined;
    }
    const taskId = payload?.["taskId"];
    const submission = payload?.["submission"];
    if (payload === undefined || typeof taskId !== "string" || submission === null || typeof submission !== "object" || Array.isArray(submission)) {
      return inner(request);
    }
    const safe = serverSubmission(submission as Trace);
    const forwarded = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({ ...payload, submission: safe }),
    });
    const response = await inner(forwarded);
    const task = await bench.getTask(taskId);
    if (response.status !== 200 || task === undefined) return response;
    const body = (await response.json()) as Record<string, JsonValue>;
    const seed = typeof payload["seed"] === "number" ? (payload["seed"] as number) : 1;
    return Response.json({ ...body, latency: submissionLatency(task, safe, seed) }, { status: 200 });
  };
}

export const handler = createApi();
