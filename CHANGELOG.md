# Changelog

## 0.1.0 - 2026-10-16

Initial alpha release.

- 36 seeded episode tasks across voice, UI, and background deadline
  classes; each deadline is set at 1.5-2x the task's shortest correct path
  (voice 447-641 ms, UI 875-1494 ms, background 2025-3714 ms).
- Deterministic `qualityWithinBudget` grader: the answer must name exactly
  one candidate value, be grounded in replayed tool output, and arrive
  inside the deadline.
- Virtual clock: scheduled per-tool latencies plus model turn time,
  measured wall-clock by default or declared `thinkMs` per turn
  (`--clock declared`, `LATENCY_BUDGET_CLOCK=declared`).
- SDK, CLI (`--tasks`, `--clock`), MCP stdio server, and fetch-style HTTP
  API from one `defineBenchmark` package.
- Run reports carry a `latency` block: p50/p95 billed time,
  `lateButCorrect`, clock counts, and the 0.5x-4x deadline curve. MCP
  `run_benchmark` returns the same block; `POST /v1/score` and MCP
  `score_answer` return a per-submission `latency` block and bill
  submitted traces at the declared rate.
- Hidden split generation (`--split hidden`) derives prompts and answers
  from a transformed seed and prefixes task ids with `h-`.
