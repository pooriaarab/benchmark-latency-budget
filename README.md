# benchmark-latency-budget

[![npm](https://img.shields.io/npm/v/benchmark-latency-budget)](https://www.npmjs.com/package/benchmark-latency-budget) [![downloads](https://img.shields.io/npm/dm/benchmark-latency-budget)](https://www.npmjs.com/package/benchmark-latency-budget) [![license](https://img.shields.io/npm/l/benchmark-latency-budget)](./LICENSE) [![types](https://img.shields.io/badge/TypeScript-types-3178c6)](#sdk)

[AI Benchmark Index](https://private-repo-337e.com/benchmarks/benchmark-latency-budget) · [npm](https://www.npmjs.com/package/benchmark-latency-budget) · [API](#http-api) · [MCP](#model-context-protocol)

A right answer that arrives too late is a wrong answer in a voice call or a
busy UI. benchmark-latency-budget checks whether an agent gives the correct
answer before its deadline. Tasks come in voice, UI, and background classes,
and each deadline is set at 1.5-2x the shortest correct path, so chatty
agents run out of time. The agent sees its deadline in the system text and
can audit tool costs with a `describe_tools` call.

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
| voice-01 | 0.0% | No candidate value found in the answer; 0ms against a 641ms deadline. |
| voice-02 | 100.0% | Correct answer in 121ms, within the 484ms deadline. |
```

The tasks are seeded synthetic directory, calendar, and doc lookups. Seed
20261015 reproduces the public set; a hidden split derives from a
transformed seed, so its prompts and answers never repeat the public one
and its task ids carry an `h-` prefix.

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
total time fits the deadline, else 0. Totals add model turn time to every
scheduled tool charge. Turn time is measured wall-clock by default, or the
declared `thinkMs` (80 ms) per turn when the clock is declared
(`--clock declared` or `LATENCY_BUDGET_CLOCK=declared`) for repeatable
runs. A correct answer past the deadline scores 0 on the headline and is
counted as `lateButCorrect`, so you can tell slowness apart from
wrongness. Every run report also carries a `latency` block with p50/p95
total time, the `lateButCorrect` count, and a quality-vs-deadline curve
at 0.5x, 1x, 2x, and 4x each deadline.

Measured mode bills real wall-clock turn time, and the deadlines assume
about 80 ms of model time per turn (the declared `thinkMs`). A hosted chat
model that needs a second or more per turn will therefore score near 0 in
measured mode on voice and UI tasks — that is what the benchmark is
measuring. For cross-model comparisons where raw speed should not
dominate, run `--clock declared` so every model is billed the same 80 ms
per turn.

## How it works

```text
seeded tasks -> agent tools (lookup, calendar_get, search_docs, describe_tools)
  -> virtual clock (model turn time + scheduled ms per call)
  -> deterministic grader (one candidate + grounded + on time)
  -> CLI / SDK / MCP / HTTP API
```

The runner keeps task order and records score, reason, latency, retries,
usage, and cost when available. Model turn time is billed from the
environment's wall-clock record; run with a declared clock when results
must repeat bit for bit across machines.

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

Each task sets `deadlineMs` at 1.5-2x its shortest correct path (declared
turn time plus scheduled call charges), so slower schedules get wider
budgets and nothing is loose enough to hide wasted calls. The shipped data
spans voice 447-641 ms, UI 875-1494 ms, background 2025-3714 ms.

| Class | Minimal calls | Deadline range | What burns the budget |
| --- | --- | --- | --- |
| voice | 1 | 447-641 ms | A repeat lookup or a wrong first guess |
| UI | 2 | 875-1494 ms | Redundant searches before the follow-up call |
| background | 3 | 2025-3714 ms | Long chains of speculative calls |

Per-call charges range from 100 ms (voice lookup) to 700 ms (background
search). Retrying a failed call costs the full charge again, and the
read-only `describe_tools` audit costs a flat 25 ms.

## Common use cases

1. **Model developers:** compare adapters with the same seeded tasks.
2. **Agent developers:** inspect task-level failures before changing prompts.
3. **Release teams:** run the mock gate before publishing a data update.
4. **Researchers:** export per-task scores for a reproducible analysis.

## Features

- **Deterministic grading:** Each row includes a score and reason.
- **Reproducible data:** A committed seeded script creates the public tasks.
- **Virtual clock:** Tool time is scheduled and model turns are measured or declared, so runs are fair and can repeat exactly.
- **Share cards:** The `card` command writes a 1200×630 SVG with the benchmark name, the model, and the score.
- **Provenance:** Code and Markdown carry the same source record.

## SDK

```ts
import { benchmark, run, score } from "benchmark-latency-budget";
import { createLatencyBenchmark, latencyReport } from "benchmark-latency-budget";
```

`run(adapter, options)` creates a report with a `latency` summary block.
`score(taskId, submission)` grades one trace. `totalTimeMs(task, submission)`
returns the billed total and `sweepDeadlines(task, submission)` returns the
0.5x–4x curve. `createLatencyBenchmark({ tasksPath, clock })` builds a
benchmark over a different tasks file or clock mode, and
`latencyReport(report)` adds the summary to any stored run report.

## CLI

Commands are `list`, `show`, `run`, `score`, `card`, `provenance`,
`index-entry`, `serve`, and `mcp`. Pass `--json` for machine-readable output.
Two flags work on every command: `--tasks <path>` swaps the packaged task set
for another JSONL file (for example a generated hidden split), and
`--clock measured|declared` picks measured wall-clock turns or the repeatable
declared `thinkMs` per turn.

## Model Context Protocol

Start the MCP stdio server:

```bash
npx benchmark-latency-budget mcp
```

Tools are `list_tasks`, `get_task`, `score_answer`, `run_benchmark`, and
`get_provenance`. `run_benchmark` returns the report with the `latency`
summary and accepts `provider: "mock"` for offline runs; `score_answer`
replies with a per-submission `latency` timing block.

## HTTP API

Import `handler` from `benchmark-latency-budget/api`, or run
`npx benchmark-latency-budget serve`. Routes are `GET /health`,
`GET /v1/tasks`, `GET /v1/tasks/:id`, `POST /v1/score`,
`GET /v1/provenance`, and `GET /v1/index-entry`. `POST /v1/score` returns
the score plus a `latency` timing block (deadline, billed total, clock
mode, on-time flag). Server surfaces ignore self-reported measured turn
times — a caller cannot prove them — so submitted traces are billed at the
declared rate.

## Data provenance

`data/tasks.jsonl` contains the 36 public tasks. `data/PROVENANCE.md` names
the generator, seed, licence, cutoff, and refresh steps. Run
`npm run generate:tasks` to rebuild the public set and
`node scripts/gen-tasks.mjs --seed <n> --split hidden` for a hidden split
(written to gitignored `artifacts/`, never published).

## Limits and known weaknesses

No public leaderboard yet: only the mock provider has been run here, so the
sample table above shows mock behavior, not model rankings. Declared mode
cannot see where turns broke in a flat tool log, so each recorded call is
billed as its own turn; measured mode fixes that but depends on the machine.
Synthetic fixtures are small, so agents can look faster than on messy real
tools. Public tasks can enter training data; keep a separately seeded hidden
split for final comparisons. Remote providers can add cost and retain
prompts under their own policies.

## Prior art

There is no single prior benchmark this copies. The episode simulator
pattern follows `benchmark-core`'s seeded `OrderLookupEnvironment`, and the
deadline framing follows the conversational-systems practice of treating a
late reply as a failure. The difference here is the virtual clock: tool time
is scheduled per call and model turn time is recorded by the environment or
declared, so nothing depends on per-call wall-clock jitter.

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

The answer must name exactly one of the task's candidate values
(case-insensitive, word-bounded) and a replayed tool result must ground it,
then the total time must fit the deadline. Model judging is off.

### How is this different from a general leaderboard?

It measures one named behavior with inspectable tasks and grading. General
leaderboards combine broader capabilities.

### Can I use a hidden split?

Yes. Generate one with `--split hidden` into `artifacts/` and run it with
`--tasks artifacts/tasks.hidden.jsonl`. Keep it out of the npm package and
the public repository.

## License

[MIT](LICENSE) © Pooria Arab

## Cite

Please cite this package with its Zenodo DOI. The DOI below names all versions. GitHub also shows a "Cite this repository" box from `CITATION.cff`.

```bibtex
@software{arab2026benchmarklatencybudget,
  author  = {Arab, Pooria},
  title   = {benchmark-latency-budget},
  year    = {2026},
  version = {0.1.0},
  doi     = {10.5281/zenodo.23422392},
  url     = {https://private-repo-337e.com/benchmarks/benchmark-latency-budget}
}
```
