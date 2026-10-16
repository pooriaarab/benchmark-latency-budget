# Latency Budget provenance

This file is generated from the benchmark definition.

## Seeded latency-budget task generator

- Kind: `synthetic`
- URL: https://github.com/pooriaarab/benchmark-latency-budget/blob/main/scripts/gen-tasks.mjs
- Licence: `MIT`
- Retrieved: 2026-10-16T00:00:00.000Z
- How to get it: Run `node scripts/gen-tasks.mjs --seed 20261015` for the public tasks, or `node scripts/gen-tasks.mjs --seed <n> --split hidden` for a hidden split (written to gitignored artifacts/).
- Contamination notes: Public tasks generated with seed 20261015, benchmark cutoff 2026-10-16. Public tasks may enter training data; use a separately seeded hidden split for final comparisons.
- Refresh: Pick a new seed, run the generator, review the JSONL diff. Regenerate quarterly or when saturation is shown.
