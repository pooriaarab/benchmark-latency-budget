# Latency Budget study plan

Status: committed before study data. This is a local plan, not an independent registry deposit.
The author is Pooria Arab. The study uses no paid inference and no human participants.

## Question and prior knowledge
No study runs exist at registration. Source inspection reveals 36 public tasks, three time classes, and a scripted oracle.
The accepted honesty pilot supplies shared layout and statistics only. No honesty outcomes or prose transfer.
H1: the privileged shortest-path oracle earns full deadline credit; blind controls earn none.
H2: simulated extra calls and increased declared thinking time weakly reduce deadline credit while preserving grounded correctness.
H3: removing simulated redundant calls weakly improves deadline credit. Zero effects remain reported.
These are checks of the measurement instrument, not claims about learned models.

## Frozen design
Freeze source c82bd8290465f96171a1e6776402ff8777c668cf and its lockfile and public tasks.
Run seven controls: packaged-good, packaged-bad, empty, constant (OK), echo (user prompt), refuse, and first-tool (empty arguments, then empty answer).
The oracle uses the packaged minimal calls and expected answer. It has privileged access; blind controls do not.
Run an extra simulated factorial experiment: declared thinkMs in [0,80,160,320] crossed with extra calls in [0,1,2,4].
Each simulated policy executes the oracle path, repeats its last successful call the stated number of times, then submits the expected answer.
Keep original deadlines and schedules fixed. Change only declared thinkMs in copied task inputs.
A simulated duplicate-removal control is the zero-extra-call cell at the same thinking time. This is an ideal controller, not a learned guard.
Use the public benchmark runner, mock adapter, and declared environment. No hand-scored substitute.
Use seed 1, concurrency 1, retries 0, maxTurns 12, maxToolCalls 12, budgetUsd 0.
Run every condition twice. Compare semantic traces after removing wall-clock metadata; repeats do not enlarge statistical sample size.

## Measures and analysis
Primary: mean qualityWithinBudget over the fixed 36-task suite. Also report grounded correctness and late-but-correct fractions.
Report 95% Wilson intervals for binary rates, with task as unit. They assume hypothetical sampling; the public suite is not a population sample.
Report per-class rates, p50/p95 virtual times, and rescored deadline curves at factors [0.5,1,2,4].
Paired contrasts compare each simulated extra-call cell to zero extra calls, within thinking time.
Use 2000 bootstrap draws, seed 20261029, preserving voice/UI/background strata and pairing by task ID.
Intervals describe task variation, not model randomness. Boundary intervals may collapse. Do not use p-values or infer general agent superiority.
Figures: task time coverage; control scores; simulated deadline curves; simulated factorial sweep.

## Exclusions and stopping
Stop after seven controls and sixteen simulated cells, each with 36 tasks and two runs: 1656 episodes.
No outcome-based exclusions. Empty outputs, refusals, errors returned by tools, and malformed answers remain failures.
Runner infrastructure errors abort the study rather than disappear from denominators. Retry only after documenting the cause.
No free hosted model is selected. This study does not probe provider availability or use provider credentials.
The absence of learned-model results must remain explicit; free service availability elsewhere is unknown.

## Failure modes and evidence
Before implementation, guard against wrong task joins, dropped submissions, stale source files, clock-mode drift, and charged-time errors.
Verify raw scores through the public scorer, raw-to-summary counts, correct denominator, semantic repeat hashes, and monotonic deadline curves.
Verify simulated input changes preserve deadlines and all other task fields. Preserve raw reports, copied inputs, source hashes, and seed settings.
Build with the copied template. Require at least eight PDF pages, resolved citations, three data figures, and ASCII metadata abstract.
Do not publish or merge. Keep generated PDF and render evidence out of git. Report all planned results and any deviations.
