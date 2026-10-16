# Grading for benchmark-latency-budget

This file is written before the grader code. It lists every way the grader
can fail, so the end-to-end test can pin each one.

## What is scored

Each task is an episode against a seeded service simulator with four tools:
`lookup`, `calendar_get`, `search_docs`, and the read-only `describe_tools`.
Every tool call costs a fixed number of virtual milliseconds from a per-task
schedule stored in `metadata.latencyMs`; `describe_tools` costs a flat 25 ms
so cost discovery stays viable, and unknown tools cost 150 ms.

The system text tells the agent the task's deadline class and the exact
`deadlineMs`, and tells it to reply with the value only. This is
intentional: the benchmark scores quality inside a deadline, so the model
must know the deadline it is being scored against. Tool costs are not
printed up front; the agent can learn them with one cheap `describe_tools`
call.

Model turn time is billed in one of two modes:

- **Measured** (default for `run`): the environment stamps the wall-clock
  gap before every tool call and before the final answer, then writes
  `clock: "measured"` and `turnTimesMs` into `finalState`. The grader sums
  those gaps as model time, so a model that sits on a request for 1501 ms
  really is billed 1501 ms.
- **Declared**: the environment marks `clock: "declared"` (the
  `LATENCY_BUDGET_CLOCK=declared` environment variable or the SDK/CLI clock
  option), and the grader bills `metadata.thinkMs` per model turn instead.
  A flat tool log cannot show where turns broke, so declared mode bills one
  turn per recorded call plus one for the final answer. Batched calls are
  billed as separate turns, which is conservative.

```
totalTimeMs = model turn time (measured or declared) + sum of scheduled latencies
```

`qualityWithinBudget = 1` only when the final answer is correct **and**
`totalTimeMs <= metadata.deadlineMs`. A correct answer that arrives late
scores 0 on the headline and is counted separately as `lateButCorrect`.

Traces submitted through `score`/`/v1/score`/`score_answer` have no
environment record, so they are billed in declared mode. A submitted trace
that carries `clock: "measured"` times is trusted as written; use the
benchmark's own runs for comparisons.

## Answer extraction

The agent is told to reply with the value only, but honest models still
wrap it (`The answer is 8929.`). The grader extracts the answer with a
word-bounded, case-insensitive match over the task's candidate values
(`metadata.candidates`; falls back to the expected value alone):

- Exactly one candidate named and it is the expected value: correct text.
- Zero candidates named: incorrect.
- Two or more candidates named: incorrect. An answer that lists every
  option is a gamed answer, not an answer.

`Room 3B` vs `3b` is tolerated because the match is case-insensitive.
Substrings inside longer tokens do not match (`18929` is not `8929`).

## Ways the grader can fail

1. **Clock skew:** the schedule lookup misses a tool name and charges 0,
   hiding wasted calls. Guard: unknown tools cost a 150 ms default and
   `describe_tools` costs a flat 25 ms.
2. **Ungrounded guess:** the answer matches but no tool output contains it
   (the agent guessed without calling tools). Guard: require evidence, a
   tool result whose JSON contains the expected string. A match is ignored
   when the call's own arguments already hold the answer, and `search_docs`
   never echoes the query, so feeding the answer back as a query proves
   nothing.
3. **Phrasing drift:** `The answer is 8929.` or `Room 3b` marked wrong.
   Guard: bounded candidate extraction, not whole-message equality.
4. **Empty or missing answer:** no `answer` field, or an empty string.
   Guard: scores 0.
5. **Answer stuffing:** listing every candidate value to always include
   the right one. Guard: naming more than one candidate is incorrect.
6. **Flat think time:** one `thinkMs` charge per task lets a slow model
   win. Guard: `thinkMs` is billed per turn, and measured mode bills real
   wall-clock turn latency recorded by the environment.
7. **Replay divergence:** grading a different trace than the agent ran.
   Guard: replay the recorded `toolLog` against a fresh simulator with the
   task seed and re-derive results from replay, not from logged results.
8. **Deadline off-by-one:** `total == deadline` must pass (`<=`).
9. **Error results counted as evidence:** an error payload echoing the
   answer must not ground it. Guard: only successful results count.
10. **Late-but-correct hidden:** headline 0 could mean wrong or late.
    Guard: report `lateButCorrect` separately, plus p50/p95 of total time
    and a quality-vs-deadline curve at 0.5x, 1x, 2x, and 4x the deadline.
11. **Non-determinism:** wall-clock or map ordering changes the score.
    Guard: declared mode bills only `thinkMs` per turn plus scheduled
    latencies, fixed key order, seeded generator; the same seed always
    regenerates the same `tasks.jsonl`. Measured-mode totals depend on the
    machine by design.

## Bad-answer and good-answer passes

The E2E asserts every one of these on every task: empty answer, random
string, always `yes`, every candidate value listed, an ungrounded correct
answer, and a correct answer padded past the deadline each score 0; honest
paraphrases (`The answer is X.`, `**X**`, `Answer: X`) and the mock good
policy (minimal correct calls plus the expected answer) score 1. A hand
built trace with `clock: "measured"` and a 1501 ms turn on a 700 ms voice
task scores 0 while the same trace marked `declared` stays billable. The
deadline boundary is pinned too: the same good trace scores 1 at 1x
deadline and 0 (late) at 0.5x when the half deadline falls below its total
time.
