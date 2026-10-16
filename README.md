# benchmark-latency-budget

[![npm](https://img.shields.io/npm/v/benchmark-latency-budget)](https://www.npmjs.com/package/benchmark-latency-budget) [![downloads](https://img.shields.io/npm/dm/benchmark-latency-budget)](https://www.npmjs.com/package/benchmark-latency-budget) [![license](https://img.shields.io/npm/l/benchmark-latency-budget)](./LICENSE) [![types](https://img.shields.io/badge/TypeScript-types-3178c6)](#sdk)

[AI Benchmark Index](https://aibenchmarkindex.com/benchmarks/benchmark-latency-budget) · [npm](https://www.npmjs.com/package/benchmark-latency-budget) · [API](#http-api) · [MCP](#model-context-protocol)

A right answer that arrives too late is a wrong answer in a voice call or a
busy UI. benchmark-latency-budget checks whether an agent gives the correct
answer before its deadline: 700 ms for voice, 2 s for UI, 10 s for background
work. Each tool call burns virtual milliseconds from a seeded schedule, so
chatty agents run out of time.

```bash
npx benchmark-latency-budget run --model offline --provider mock
```

```text
# Latency Budget

- Model: `mock:1`
- Score: **47.2%**
- 95% CI: 30.6%–63.9%
- Tasks: 36

| Task | Score | Reason |
| --- | ---: | --- |
| voice-02 | 100.0% | Correct answer in 261ms, within the 700ms deadline. |
| voice-01 | 0.0% | Incorrect answer in 80ms against a 700ms deadline. |
```

The tasks are seeded synthetic directory, calendar, and doc lookups. Seed
20261015 reproduces the public set; a hidden split uses another seed.

## Install

benchmark-latency-budget requires Node.js 20 or newer.

```bash
npm install benchmark-latency-budget
```

## Run your first benchmark

The mock provider needs no key or network access.

```bash
npx benchmark-latency-budget run --model offline --provider mock
```

About half the mock answers are right and on time; the rest are wrong, so
expect a mean near 50%. A successful run prints 36 scored rows and a mean
with a bootstrap 95% confidence interval.

## Run on a real model

Point the runner at OpenRouter with any chat model:

```bash
OPENROUTER_API_KEY=sk-or-... npx benchmark-latency-budget run --model openai/gpt-4o-mini --provider openrouter
```

Any OpenAI-compatible endpoint works too:

```bash
OPENAI_BASE_URL=https://my-proxy/v1 OPENAI_API_KEY=... npx benchmark-latency-budget run --model my-model --provider openai
```

Never put keys in repo files; the runner reads them from the environment.

## How to read the score

The headline is `qualityWithinBudget`: 1 only for a correct answer whose
total virtual time fits the deadline, else 0. Totals add the declared model
turn time (80 ms for the mock) to every scheduled tool charge. A correct
answer past the deadline scores 0 on the headline and is counted as
`lateButCorrect`, so you can tell slowness apart from wrongness. The E2E
also reports p50/p95 total time and a quality-vs-deadline curve at 0.5x,
1x, 2x, and 4x each deadline.

## How it works

```text
seeded tasks -> agent tools (lookup, calendar_get, search_docs)
  -> virtual clock (thinkMs + scheduled ms per call)
  -> deterministic grader (correct + grounded + on time)
  -> CLI / SDK / MCP / HTTP API
```

The runner keeps task order and records score, reason, latency, retries,
usage, and cost when available. Wall-clock row times are reported for
context; the score uses only virtual time so results repeat across machines.

## Why it exists

General model leaderboards do not isolate agents behavior under time
pressure. This package keeps the task data, grading rules, and provenance
together for inspection.

## Compare

Checked on 2026-10-16.

| Property | benchmark-latency-budget | General chat leaderboard | Ad hoc prompt test |
| --- | --- | --- | --- |
| Target | Correct answers inside voice, UI, and background deadlines. | Broad model quality | One local example |
| Grading | Deterministic code | Varies | Manual |
| Offline run | Mock provider | Varies | Varies |
| Provenance | Package record | Varies | Usually absent |

## Coverage

| Surface | Status |
| --- | --- |
| episode tasks | Included (36: 12 voice, 12 UI, 12 background) |
| SDK | Included |
| CLI | Included |
| MCP server | Included |
| HTTP API | Included |

The E2E gate checks every listed surface against the package source.

## Deadlines

| Class | Deadline | Minimal calls | What burns the budget |
| --- | --- | --- | --- |
| voice | 700 ms | 1 | Repeat lookups or a wrong first guess |
| UI | 2 s | 2 | Redundant searches before the follow-up call |
| background | 10 s | 3 | Long chains of speculative calls |

Per-call charges range from 100 ms (voice lookup) to 700 ms (background
search). Retrying a failed call costs the full charge again.

## Common use cases

1. **Model developers:** compare adapters with the same seeded tasks.
2. **Agent developers:** inspect task-level failures before changing prompts.
3. **Release teams:** run the mock gate before publishing a data update.
4. **Researchers:** export per-task scores for a reproducible analysis.

## Features

- **Deterministic grading:** Each row includes a score and reason.
- **Reproducible data:** A committed seeded script creates the public tasks.
- **Virtual clock:** Tool time is scheduled, so scores repeat exactly.
- **Share cards:** The `card` command writes a 1200×630 SVG with the benchmark name, the model, and the score.
- **Provenance:** Code and Markdown carry the same source record.

## SDK

```ts
import { benchmark, run, score } from "benchmark-latency-budget";
import { totalTimeMs, sweepDeadlines } from "benchmark-latency-budget";
```

`run(adapter, options)` creates a report. `score(taskId, submission)` grades
one trace. `totalTimeMs(task, toolLog)` returns the virtual total and
`sweepDeadlines(task, submission)` returns the 0.5x–4x curve.

## CLI

Commands are `list`, `show`, `run`, `score`, `card`, `provenance`,
`index-entry`, `serve`, and `mcp`. Pass `--json` for machine-readable output.

## Model Context Protocol

Start the MCP stdio server:

```bash
npx benchmark-latency-budget mcp
```

Tools are `list_tasks`, `get_task`, `score_answer`, `run_benchmark`, and
`get_provenance`.

## HTTP API

Import `handler` from `benchmark-latency-budget/api`, or run
`npx benchmark-latency-budget serve`. Routes are `GET /health`,
`GET /v1/tasks`, `GET /v1/tasks/:id`, `POST /v1/score`,
`GET /v1/provenance`, and `GET /v1/index-entry`.

## Data provenance

`data/tasks.jsonl` contains the 36 public tasks. `data/PROVENANCE.md` names
the generator, seed, licence, cutoff, and refresh steps. Run
`npm run generate:tasks` to rebuild the public set and
`node scripts/gen-tasks.mjs --seed <n> --split hidden` for a hidden split
(written to gitignored `artifacts/`, never published).

## Limits and known weaknesses

No public leaderboard yet: only the mock provider has been run here, so the
sample table above shows mock behavior, not model rankings. Declared model
turn time is a constant, so the benchmark does not measure real inference
speed; compare wall-clock row times separately. Synthetic fixtures are small
and uniformly phrased, so agents can look faster than on messy real tools.
Public tasks can enter training data; keep a separately seeded hidden split
for final comparisons. Remote providers can add cost and retain prompts
under their own policies.

## Prior art

There is no single prior benchmark this copies. The episode simulator
pattern follows `benchmark-core`'s seeded `OrderLookupEnvironment`, and the
deadline framing follows the conversational-systems practice of treating a
late reply as a failure. The difference here is the deterministic virtual
clock: time is scheduled per tool call instead of measured, so scores do
not depend on the machine.

## Integration guides

- [TypeScript SDK integration](#sdk)
- [Model Context Protocol integration](#model-context-protocol)
- [HTTP API integration](#http-api)

## Status

Version 0.1.0 is alpha, saturation unknown. Task schemas and grading may
change before 1.0. Report defects through the GitHub issue tracker. Public
case studies are not yet published.

## FAQ

### What does benchmark-latency-budget measure?

Whether an agent answers correctly before a voice, UI, or background
deadline. The committed grader defines the exact pass conditions.

### Can benchmark-latency-budget run offline?

It runs end to end with the mock provider and no key. Real model runs need
a configured provider.

### Which providers work?

OpenRouter, an OpenAI-compatible base URL, and the offline mock adapter
through benchmark-core.

### Does benchmark-latency-budget provide a hosted service?

It provides a server you run. It does not provide a managed benchmark
service.

### Where do the tasks come from?

Seeded synthetic directory, calendar, and doc fixtures. The provenance file
explains how to reproduce and refresh them.

### How are answers graded?

Grounded exact match (trimmed, case-insensitive, present in a tool result)
plus a virtual deadline check. Model judging is off.

### How is this different from a general leaderboard?

It measures one named behavior with inspectable tasks and grading. General
leaderboards combine broader capabilities.

### Can I use a hidden split?

Yes. Generate one with another seed into `artifacts/` and keep it out of
the npm package and the public repository.

## License

[MIT](LICENSE) © Pooria Arab
