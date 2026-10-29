import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { run, mockAdapter } from 'benchmark-core';
import { createLatencyBenchmark, latencyReport, isCorrect, timeBreakdown, sweepDeadlines, deadlineRanges } from '../../dist/index.js';
import { wilson, bootstrap, mean } from '../template/stats.mjs';
export const hash = x => createHash('sha256').update(x).digest('hex');
export const semantic = report => report.rows.map(r => ({ taskId: r.taskId, score: r.score, reason: r.reason, answer: r.submission.answer, toolLog: r.submission.toolLog, transcript: r.episode.transcript, clock: r.submission.finalState.clock }));
const config = JSON.parse(await readFile('paper/config.json'));
const original = await createLatencyBenchmark().listTasks(), classes = ['voice', 'ui', 'background'];
const options = { seed: 1, concurrency: 1, retries: 0, maxTurns: 12, maxToolCalls: 12, budgetUsd: 0 };
const policies = ['packaged-good', 'packaged-bad', 'empty', 'constant', 'echo', 'refuse', 'first-tool'];
const conditions = [...policies.map(policy => ({ policy, think: 80, extra: 0, simulated: false })), ...[0,80,160,320].flatMap(think => [0,1,2,4].map(extra => ({ policy: 'oracle-repeat', think, extra, simulated: true })))];
const save = (name, x) => writeFile(`paper/data/${name}.generated.json`, JSON.stringify(x, null, 2) + '\n');
await mkdir('paper/data', { recursive: true });
const sources = ['data/tasks.jsonl', 'package-lock.json', 'src/index.ts', 'src/benchmark.ts', 'src/latency.ts', 'src/simulator.ts', 'scripts/gen-tasks.mjs'];
for (const p of sources) assert.equal(hash(await readFile(p)), hash(execFileSync('git', ['show', `${config.source_commit}:${p}`])), `Frozen input changed: ${p}`);
const reports = [], repeats = [], stats = [];
for (const c of conditions) {
  const tasks = original.map(t => ({ ...t, metadata: { ...t.metadata, thinkMs: c.think } }));
  const path = `paper/data/tasks-think-${c.think}.generated.json`;
  await writeFile(path, tasks.map(t => JSON.stringify(t)).join('\n') + '\n');
  const bench = createLatencyBenchmark({ tasksPath: path, clock: 'declared' });
  const scripted = task => {
    if (c.policy.startsWith('packaged-')) return bench.definition.mockPolicies[c.policy.slice(9)](task);
    if (c.simulated) { const calls = task.metadata.minimalCalls; return [...calls, ...Array(c.extra).fill(calls.at(-1))].map(call => ({ toolCalls: [call] })).concat({ content: task.expected }); }
    if (c.policy === 'first-tool') return [{ toolCalls: [{ name: 'lookup', args: {} }] }, { content: '' }];
    return [{ content: { empty: '', constant: 'OK', echo: task.prompt, refuse: 'I cannot help with that request.' }[c.policy] }];
  };
  const execute = () => run(bench, mockAdapter({ seed: 1, policies: { good: scripted, bad: scripted } }), options).then(r => latencyReport(r, tasks));
  const report = await execute(), repeat = await execute();
  for (const r of [report, repeat]) { assert.deepEqual(r.rows.map(x => x.taskId), tasks.map(t => t.id)); assert.ok(r.rows.every(x => !x.error && x.submission && !x.episode.aborted)); assert.equal(r.totals.costUsd ?? 0, 0); }
  const digest = hash(JSON.stringify(semantic(report))), repeatDigest = hash(JSON.stringify(semantic(repeat)));
  assert.equal(digest, repeatDigest);
  const rows = await Promise.all(report.rows.map(async (r, i) => {
    const t = tasks[i], timing = timeBreakdown(t, r.submission), correct = isCorrect(t, r.submission), score = await bench.score(t, r.submission);
    assert.equal(r.score, score.score); assert.equal(timing.clock, 'declared');
    const independentTime = c.think * (r.submission.toolLog.length + 1) + r.submission.toolLog.reduce((sum, call) => sum + (t.metadata.latencyMs[call.name] ?? 150), 0);
    assert.equal(timing.totalMs, independentTime);
    return { taskId: t.id, cls: t.metadata.budgetClass, score: r.score, correct: +correct, late: +(correct && timing.totalMs > t.metadata.deadlineMs), ...timing, curve: sweepDeadlines(t, r.submission) };
  }));
  const rates = rs => Object.fromEntries(['score', 'correct', 'late'].map(key => [key, wilson(rs.reduce((s,r) => s + r[key], 0), rs.length)]));
  const curve = [0.5,1,2,4].map((factor,i) => ({ factor, ...wilson(rows.reduce((s,r) => s + r.curve[i].score, 0), rows.length) }));
  assert.equal(report.mean, mean(rows.map(r => r.score)));
  stats.push({ ...c, ...rates(rows), byClass: Object.fromEntries(classes.map(cls => [cls, rates(rows.filter(r => r.cls === cls))])), p50: report.latency.p50Ms, p95: report.latency.p95Ms, curve, rows });
  reports.push({ ...c, report }); repeats.push({ ...c, sha256: digest, repeatSha256: repeatDigest, report: repeat });
}
const contrasts = stats.filter(s => s.simulated && s.extra > 0).map(s => {
  const baseline = stats.find(b => b.simulated && b.think === s.think && b.extra === 0);
  const pairs = s.rows.map((r,i) => { assert.equal(r.taskId, baseline.rows[i].taskId); return { cls: r.cls, delta: baseline.rows[i].score - r.score }; });
  return { think: s.think, extra: s.extra, improvement: bootstrap(classes.map(cls => pairs.filter(r => r.cls === cls)), gs => mean(gs.flat().map(r => r.delta))) };
});
const coverage = deadlineRanges(original).map(c => ({ ...c, calls: original.find(t => t.metadata.budgetClass === c.budgetClass).metadata.minimalCalls.length }));
const summary = { schema_version: 1, options, tasks: original.length, conditions: conditions.length, episodes: original.length * conditions.length * 2, costUsd: 0, ciLevel: 95, coverage, stats, contrasts, repeatIdentical: true, freeModels: { status: 'not-run', reason: 'No hosted-model arm or availability probe was planned; no provider credentials were used.' } };
await save('runs', reports); await save('repeat', repeats); await save('summary', summary);
const tracked = [...sources, 'paper/PREREG.md', 'paper/config.json', 'paper/scripts/run.mjs', 'paper/scripts/render.mjs', 'paper/scripts/verify.mjs', 'paper/template/stats.mjs'];
await save('provenance', { source_commit: config.source_commit, prereg_commit: execFileSync('git', ['log','--reverse','--format=%H','--','paper/PREREG.md'], { encoding: 'utf8' }).trim().split('\n')[0], node: process.version, files: Object.fromEntries(await Promise.all(tracked.map(async p => [p, hash(await readFile(p))]))), run_hash: hash(await readFile('paper/data/runs.generated.json')) });
console.log(`Completed ${summary.episodes} episodes; ${conditions.length} repeated conditions agree; API cost USD 0`);
