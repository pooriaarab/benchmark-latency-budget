# Grading for benchmark-latency-budget

This file is written before the grader code. It lists every way the grader
can fail, so the end-to-end test can pin each one.

## What is scored

Each task is an episode against a seeded service simulator with three tools:
`lookup`, `calendar_get`, and `search_docs`. Every tool call costs a fixed
number of virtual milliseconds from a per-task schedule stored in
`metadata.latencyMs`. The agent's model turn time is a declared constant in
`metadata.thinkMs` (80 ms for the mock), so runs are repeatable.

`totalTimeMs = thinkMs + sum of scheduled latencies for the recorded tool calls`

`qualityWithinBudget = 1` only when the final answer is correct **and**
`totalTimeMs <= metadata.deadlineMs`. A correct answer that arrives late
scores 0 on the headline and is counted separately as `lateButCorrect`.

Real wall-clock time is reported, not graded. Each run row carries the
runner-measured `latencyMs` (wall clock). Compare it with the virtual total
to see simulator overhead versus model time; the score itself uses only the
virtual total so results do not depend on the machine they ran on.

## Ways the grader can fail

1. **Clock skew:** the schedule lookup misses a tool name and charges 0,
   hiding wasted calls. Guard: unknown tools cost a 150 ms default.
2. **Ungrounded guess:** the answer matches but no tool output contains it
   (the agent guessed without calling tools). Guard: require evidence, a
   tool result whose JSON contains the expected string. A match is ignored
   when the call's own arguments already hold the answer, and `search_docs`
   never echoes the query, so feeding the answer back as a query proves
   nothing.
3. **Case and whitespace drift:** `Room 3B` vs `3b ` marked wrong. Guard:
   compare trimmed, case-insensitive strings.
4. **Empty or missing answer:** no `answer` field, or an empty string.
   Guard: scores 0 with reason `missing`.
5. **Always-yes gaming:** answering `yes` to everything. Guard: expected
   values are never `yes`; exact match fails.
6. **Replay divergence:** grading a different trace than the agent ran.
   Guard: replay the recorded `toolLog` against a fresh simulator with the
   task seed and re-derive results from replay, not from logged results.
7. **Deadline off-by-one:** `total == deadline` must pass (`<=`).
8. **Error results counted as evidence:** an error payload echoing the
   answer must not ground it. Guard: only successful results count.
9. **Late-but-correct hidden:** headline 0 could mean wrong or late.
   Guard: report `lateButCorrect` separately, plus p50/p95 of total time
   and a quality-vs-deadline curve at 0.5x, 1x, 2x, and 4x the deadline.
10. **Non-determinism:** wall-clock or map ordering changes the score.
    Guard: virtual time only, fixed key order, seeded generator; the same
    seed always regenerates the same `tasks.jsonl`.

## Bad-answer and good-answer passes

The E2E asserts every one of these on several tasks: empty answer, random
string, always `yes`, and always the same single `search_docs` call each
score 0; the mock good policy (minimal correct calls plus the expected
answer) scores 1. The deadline boundary is pinned too: the same good trace
scores 1 at 1x deadline and 0 (late) at 0.5x when the half deadline falls
below its total time.
