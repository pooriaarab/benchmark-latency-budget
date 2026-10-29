import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createLatencyBenchmark, isCorrect, timeBreakdown, sweepDeadlines } from '../../dist/index.js';
import { wilson, bootstrap, mean } from '../template/stats.mjs';
const read = p => readFile(p,'utf8').then(JSON.parse), sha = x => createHash('sha256').update(x).digest('hex');
const s = await read('paper/data/summary.generated.json'), runs = await read('paper/data/runs.generated.json'), repeats = await read('paper/data/repeat.generated.json'), p = await read('paper/data/provenance.generated.json'), c = await read('paper/config.json'), meta = await read('paper/meta.json');
const original = await createLatencyBenchmark().listTasks(), classes = ['voice','ui','background'];
const semantic = report => report.rows.map(r=>({taskId:r.taskId,score:r.score,reason:r.reason,answer:r.submission.answer,toolLog:r.submission.toolLog,transcript:r.episode.transcript,clock:r.submission.finalState.clock}));
assert.equal(runs.length,23); assert.equal(repeats.length,runs.length); assert.equal(s.episodes,1656); assert.equal(s.costUsd,0);
for (const [index, run] of runs.entries()) {
  const expected = s.stats[index], tasks = (await readFile(`paper/data/tasks-think-${run.think}.generated.json`,'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(tasks,original.map(t=>({...t,metadata:{...t.metadata,thinkMs:run.think}})));
  const bench = createLatencyBenchmark({tasksPath:`paper/data/tasks-think-${run.think}.generated.json`,clock:'declared'});
  const digest = sha(JSON.stringify(semantic(run.report))); assert.equal(digest,repeats[index].sha256); assert.equal(digest,sha(JSON.stringify(semantic(repeats[index].report)))); assert.equal(digest,repeats[index].repeatSha256);
  assert.deepEqual(run.report.rows.map(r=>r.taskId),tasks.map(t=>t.id));
  for (const [i,row] of run.report.rows.entries()) { assert.ok(!row.error && row.submission && !row.episode.aborted); const t=tasks[i], score=await bench.score(t,row.submission), correct=+isCorrect(t,row.submission), timing=timeBreakdown(t,row.submission); assert.equal(row.score,score.score); assert.deepEqual(expected.rows[i],{taskId:t.id,cls:t.metadata.budgetClass,score:row.score,correct,late:+(correct&&timing.totalMs>t.metadata.deadlineMs),...timing,curve:sweepDeadlines(t,row.submission)}); assert.equal(correct,expected.rows[i].score+expected.rows[i].late); }
  for (const key of ['score','correct','late']) { assert.deepEqual(expected[key],wilson(expected.rows.reduce((a,r)=>a+r[key],0),tasks.length)); for (const cls of classes) { const rows=expected.rows.filter(r=>r.cls===cls); assert.deepEqual(expected.byClass[cls][key],wilson(rows.reduce((a,r)=>a+r[key],0),rows.length)); } }
  for (const [i,point] of expected.curve.entries()) { assert.deepEqual(point,{factor:point.factor,...wilson(expected.rows.reduce((a,r)=>a+r.curve[i].score,0),tasks.length)}); if(i)assert.ok(point.value>=expected.curve[i-1].value); }
  assert.equal(run.report.mean,expected.score.value); if(run.simulated)assert.equal(expected.correct.k,tasks.length);
}
for (const t of [0,80,160,320]) { const cells=s.stats.filter(r=>r.simulated&&r.think===t); for(let i=1;i<cells.length;i++)assert.ok(cells[i].score.value<=cells[i-1].score.value); }
for (const d of s.contrasts) { const a=s.stats.find(r=>r.simulated&&r.think===d.think&&r.extra===0), b=s.stats.find(r=>r.simulated&&r.think===d.think&&r.extra===d.extra); const pairs=a.rows.map((r,i)=>({cls:r.cls,delta:r.score-b.rows[i].score})); assert.deepEqual(d.improvement,bootstrap(classes.map(cls=>pairs.filter(r=>r.cls===cls)),gs=>mean(gs.flat().map(r=>r.delta)))); }
for (const [file,digest] of Object.entries(p.files)) assert.equal(sha(await readFile(file)),digest,file);
assert.equal(sha(await readFile('paper/data/runs.generated.json')),p.run_hash);
assert.equal(execFileSync('git',['ls-tree','-r','--name-only',p.prereg_commit,'paper/data'],{encoding:'utf8'}).trim(),'');
execFileSync('git',['merge-base','--is-ancestor',p.prereg_commit,'HEAD']);
assert.equal(meta.title,c.title); assert.deepEqual(meta.authors,c.authors); assert.equal(meta.license,'CC-BY-4.0'); assert.ok(meta.abstract.length<=1920&&/^[\x00-\x7F]*$/.test(meta.abstract));
const tex=await readFile('paper/paper.tex','utf8'); assert.ok(!/[\u2014]/.test(tex));
const pdf=`paper/${meta.artifact_name}`, info=execFileSync('pdfinfo',[pdf],{encoding:'utf8'}), pages=Number(info.match(/Pages:\s+(\d+)/)[1]); assert.ok(pages>=8);
const pdfText=execFileSync('pdftotext',['-layout',pdf,'-'],{encoding:'utf8'}); assert.ok(!pdfText.includes('??')); for(const word of ['simulated','Caveats','References'])assert.ok(pdfText.includes(word));
const log=await readFile('paper/paper.log','utf8'); assert.ok(!/Overfull|undefined references|undefined citations/.test(log));
const evidence={result:'pass',episodes:s.episodes,conditions:runs.length,pages,figures:4,raw_scores_replayed:true,repeat_hashes_match:true,source_hashes_match:true,prereg_precedes_data:true,pdf_sha256:sha(await readFile(pdf))};
await writeFile('paper/data/verification.generated.json',JSON.stringify(evidence,null,2)+'\n'); console.log(JSON.stringify(evidence));
