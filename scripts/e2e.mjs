import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { provenanceMarkdown } from "benchmark-core";
import {
  benchmark, DESCRIBE_TOOLS_MS, isCorrect, LatencyBudgetEnvironment, latencyMeta, score as scoreOne,
  summarizeTimes, sweepDeadlines, totalTimeMs,
} from "../dist/index.js";
const execFile = promisify(execFileCallback);

await execFile("npm", ["run", "build"]);
const cli = await execFile(process.execPath, ["dist/cli.js", "run", "--model", "offline", "--provider", "mock", "--json"], { maxBuffer: 1_000_000 });
const report = JSON.parse(cli.stdout);
assert.equal(report.rows.length, 36);
assert.ok(report.rows.some((row) => row.score === 1));
assert.ok(report.rows.some((row) => row.score === 0));

const tasks = await benchmark.listTasks();
assert.equal(tasks.length, 36);
const byId = new Map(tasks.map((task) => [task.id, task]));
let gamedChecked = 0;
for (const task of tasks) {
  const meta = latencyMeta(task);
  const goodLog = meta.minimalCalls.map((call) => ({ name: call.name, args: call.args, result: null }));
  const good = { answer: task.expected, toolLog: goodLog };
  assert.equal((await scoreOne(task.id, good)).score, 1, `${task.id} good`);
  const expectedThink = meta.thinkMs * (meta.minimalCalls.length + 1);
  const expectedTool = meta.minimalCalls.reduce((sum, call) => sum + meta.latencyMs[call.name], 0);
  assert.equal(totalTimeMs(task, goodLog), expectedThink + expectedTool);
  const paraphrases = [
    `The answer is ${task.expected}.`,
    `Answer: ${task.expected}`,
    `**${task.expected}**`,
    `${task.expected}`,
    String(task.expected).toLowerCase(),
  ];
  for (const text of paraphrases) {
    assert.equal((await scoreOne(task.id, { answer: text, toolLog: goodLog })).score, 1, `${task.id} paraphrase ${text}`);
  }
  const measuredLate = { answer: task.expected, toolLog: goodLog, finalState: { clock: "measured", turnTimesMs: [meta.deadlineMs + 1] } };
  assert.equal((await scoreOne(task.id, measuredLate)).score, 0, `${task.id} measured late`);
  const declaredSame = { answer: task.expected, toolLog: goodLog, finalState: { clock: "declared", turnTimesMs: [meta.deadlineMs + 1] } };
  assert.equal(totalTimeMs(task, declaredSame), expectedThink + expectedTool);
  assert.equal((await scoreOne(task.id, declaredSame)).score, 1, `${task.id} declared clock`);
  const others = meta.candidates.filter((value) => value.toLowerCase() !== String(task.expected).toLowerCase());
  const describeEnv = new LatencyBudgetEnvironment();
  describeEnv.reset(task, 1);
  const described = describeEnv.callTool("describe_tools", {});
  for (const tool of described.result.tools) {
    const expectedMs = tool.name === "describe_tools" ? DESCRIBE_TOOLS_MS : (meta.latencyMs[tool.name] ?? null);
    assert.equal(tool.latencyMs, expectedMs, `${task.id} describe_tools ${tool.name}`);
  }
  const describeOnlyLog = [{ name: "describe_tools", args: {}, result: null }];
  assert.equal(totalTimeMs(task, describeOnlyLog), meta.thinkMs * 2 + DESCRIBE_TOOLS_MS, `${task.id} describe_tools charge`);
  const leakTask = { ...task, expected: "4242", metadata: { ...task.metadata, latencyMs: { lookup: 4242 }, candidates: ["4242"] } };
  assert.equal(isCorrect(leakTask, { answer: "4242", toolLog: describeOnlyLog }), false, `${task.id} describe_tools is not evidence`);
  const episodeEnv = new LatencyBudgetEnvironment({ clock: "measured" });
  episodeEnv.reset(task, 1);
  for (const call of meta.minimalCalls) episodeEnv.callTool(call.name, call.args);
  const episodeState = episodeEnv.state();
  assert.equal(episodeState.clock, "measured", `${task.id} state clock`);
  assert.equal(episodeState.turnTimesMs.length, meta.minimalCalls.length + 1, `${task.id} state turn count`);
  assert.ok(episodeState.turnTimesMs.every((gap) => Number.isFinite(gap) && gap >= 0), `${task.id} state turns finite`);
  const badAnswers = [
    {},
    { answer: "xyzzy-not-an-answer" },
    { answer: "yes" },
    { answer: "yes", toolLog: [{ name: "lookup", args: { key: "Nobody Here" }, result: null }] },
    { answer: task.expected, toolLog: [] },
    { answer: task.expected, toolLog: [{ name: "search_docs", args: { query: "   " }, result: null }] },
    { answer: task.expected, toolLog: [{ name: "search_docs", args: { query: String(task.expected) }, result: null }] },
  ];
  for (const bad of badAnswers) assert.equal((await scoreOne(task.id, bad)).score, 0, `${task.id} bad answer`);
  if (others.length > 0) {
    gamedChecked++;
    const gamed = [
      { answer: meta.candidates.join(", "), toolLog: goodLog },
      { answer: `${task.expected} or ${others[0]}`, toolLog: goodLog },
      { answer: `${others[0]}`, toolLog: goodLog },
    ];
    for (const bad of gamed) assert.equal((await scoreOne(task.id, bad)).score, 0, `${task.id} gamed ${bad.answer}`);
  }
  const curve = sweepDeadlines(task, good);
  assert.deepEqual(curve.map((point) => point.factor), [0.5, 1, 2, 4]);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i].score >= curve[i - 1].score);
  assert.equal(curve[1].score, 1, `${task.id} curve 1x`);
  const total = totalTimeMs(task, goodLog);
  assert.equal(curve[0].score, total <= Math.round(meta.deadlineMs * 0.5) ? 1 : 0, `${task.id} curve 0.5x`);
  const lateLog = [...goodLog];
  while (totalTimeMs(task, lateLog) <= meta.deadlineMs && lateLog.length < goodLog.length + 24) {
    lateLog.push({ name: "search_docs", args: { query: "zzzz-no-match" }, result: null });
  }
  assert.ok(totalTimeMs(task, lateLog) > meta.deadlineMs, `${task.id} padding exceeded deadline`);
  const late = { answer: task.expected, toolLog: lateLog };
  assert.equal(isCorrect(task, late), true, `${task.id} padded still correct`);
  assert.equal((await scoreOne(task.id, late)).score, 0, `${task.id} padded late`);
}
assert.ok(gamedChecked >= 30, `expected gamed checks on most tasks, got ${gamedChecked}`);

const hidden = await execFile(process.execPath, ["scripts/gen-tasks.mjs", "--split", "hidden"]);
assert.match(hidden.stdout, /tasks\.hidden\.jsonl/);
const hiddenTasks = (await readFile("artifacts/tasks.hidden.jsonl", "utf8")).trim().split("\n").map((line) => JSON.parse(line));
assert.equal(hiddenTasks.length, 36);
const publicById = new Map(tasks.map((task) => [task.id, task]));
let differentPrompts = 0; let differentAnswers = 0;
for (const hiddenTask of hiddenTasks) {
  const publicTask = publicById.get(hiddenTask.id);
  assert.ok(publicTask !== undefined, `${hiddenTask.id} missing from public ids`);
  if (hiddenTask.prompt !== publicTask.prompt) differentPrompts++;
  if (String(hiddenTask.expected) !== String(publicTask.expected)) differentAnswers++;
  assert.ok(Array.isArray(hiddenTask.metadata.candidates) && hiddenTask.metadata.candidates.length >= 2);
}
assert.ok(differentPrompts >= 30, `only ${differentPrompts} hidden prompts differ`);
assert.ok(differentAnswers >= 30, `only ${differentAnswers} hidden answers differ`);

const timingEntries = report.rows.map((row) => {
  const task = byId.get(row.taskId);
  const log = row.submission?.toolLog ?? [];
  const total = totalTimeMs(task, log);
  const correct = isCorrect(task, row.submission ?? {});
  return { totalTimeMs: total, correct, onTime: total <= latencyMeta(task).deadlineMs, score: row.score };
});
const timing = summarizeTimes(timingEntries);
assert.equal(timing.count, 36);
assert.ok(timing.p50 <= timing.p95);
assert.equal(timing.lateButCorrect, timingEntries.filter((e) => e.correct && !e.onTime).length);
const voice01 = byId.get("voice-01");
const sampleCurve = sweepDeadlines(voice01, { answer: voice01.expected, toolLog: latencyMeta(voice01).minimalCalls.map((call) => ({ name: call.name, args: call.args, result: null })) });

const probe = createNetServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const address = probe.address(); assert.ok(address && typeof address === "object");
await new Promise((resolve) => probe.close(resolve));
const server = spawn(process.execPath, ["dist/cli.js", "serve", String(address.port)], { stdio: ["ignore", "pipe", "pipe"] });
const base = `http://127.0.0.1:${address.port}`; const routes = {};
async function get(path) {
  const response = await fetch(`${base}${path}`); routes[`GET ${path}`] = response.status;
  return { response, value: await response.json() };
}
try {
  for (let attempt = 0; attempt < 100; attempt++) { try { await get("/health"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); } }
  const health = await get("/health"); assert.equal(health.response.status, 200);
  const listed = await get("/v1/tasks"); assert.equal(listed.value.tasks.length, 36);
  const shown = await get("/v1/tasks/voice-01"); assert.equal(shown.value.task.id, "voice-01");
  const score = await fetch(`${base}/v1/score`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: "voice-01", submission: report.rows[0].submission }) });
  routes["POST /v1/score"] = score.status; assert.equal(score.status, 200);
  assert.equal((await get("/v1/provenance")).response.status, 200);
  assert.equal((await get("/v1/index-entry")).value.task_count, 36);
} finally { if (server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); } }

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js", "mcp"], cwd: process.cwd(), stderr: "pipe" });
const client = new Client({ name: "benchmark-latency-budget-e2e", version: "0.1.0" });
await client.connect(transport); let toolNames;
try {
  const available = await client.listTools(); toolNames = available.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ["get_provenance", "get_task", "list_tasks", "run_benchmark", "score_answer"]);
  const calls = [
    ["list_tasks", {}], ["get_task", { taskId: "voice-01" }],
    ["score_answer", { taskId: "voice-01", submission: report.rows[0].submission }],
    ["get_provenance", {}], ["run_benchmark", { model: "offline" }],
  ];
  for (const [name, args] of calls) {
    const result = await client.callTool({ name, arguments: args });
    if (name === "run_benchmark") assert.equal(result.isError, true); else assert.notEqual(result.isError, true);
  }
} finally { await client.close(); }

assert.equal(await readFile("data/PROVENANCE.md", "utf8"), provenanceMarkdown(benchmark));
const artifact = {
  task_count: report.rows.length, scores: report.rows.map((row) => row.score),
  route_status_codes: routes, tool_names: toolNames,
  timing: { p50_ms: timing.p50, p95_ms: timing.p95, late_but_correct: timing.lateButCorrect },
  sample_curve_voice_01: sampleCurve,
};
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/e2e-report.json", `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`e2e: ${artifact.task_count} tasks, ${Object.keys(routes).length} routes, ${toolNames.length} tools, p50 ${timing.p50}ms p95 ${timing.p95}ms -> all surfaces passed, ok`);
