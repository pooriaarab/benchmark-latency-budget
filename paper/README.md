# Latency Budget paper packet

Install with `npm ci`. Run `sh paper/template/reproduce.sh` from the repository root.
Requirements: Node 20+, npm, Python 3, Tectonic, and Poppler (`pdfinfo`, `pdftotext`).
The command builds the benchmark, runs experiments, renders figures, builds the PDF, and verifies the packet.
The output is `paper/latency-budget-paper.pdf`. PDFs, logs, and downloaded styles stay untracked.
The unchanged pilot template verifies the official NeurIPS style archive. The first build can download TeX dependencies.
Experiments use local scripts, no network requests, and no provider credentials.

The committed plan precedes data. It is not an external preregistration deposit.
Seven scripted controls and sixteen simulated cells each run twice on the same 36 tasks.
The simulated sweep varies declared thinking time and redundant successful calls. It does not measure learned agents.
Generated traces retain reports and tool transcripts. Repeat hashes omit incidental wall-clock state only.
Task files named `tasks-think-*.generated.json` contain JSON Lines, matching the benchmark loader.
`summary.generated.json` contains Wilson intervals and paired, stratified bootstrap comparisons.
`verification.generated.json` records replay checks, hashes, page count, and the built PDF hash.
The code and task license stays MIT. Paper text and generated figures use CC-BY-4.0.
The family paper supplies construct wording and coverage checks. No honesty data or prose is reused.
Do not publish or merge automatically. The parent handles review and publication.
