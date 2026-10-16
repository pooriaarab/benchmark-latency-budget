#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  createCli, mockAdapter, openaiCompatAdapter, openrouterAdapter, renderMarkdown, run as runReport,
  type Benchmark, type ModelAdapter, type RunOptions, type Task,
} from "benchmark-core";
import { benchmark, createLatencyBenchmark, latencyReport } from "./index.js";
import type { ClockMode } from "./simulator.js";

const BIN = "benchmark-latency-budget";

interface GlobalOptions { rest: string[]; tasksPath?: string; clock?: ClockMode }

function stripGlobalOptions(argv: string[]): GlobalOptions {
  const rest: string[] = [];
  let tasksPath: string | undefined;
  let clock: ClockMode | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--tasks") tasksPath = argv[++i];
    else if (arg.startsWith("--tasks=")) tasksPath = arg.slice("--tasks=".length);
    else if (arg === "--clock") clock = argv[++i] as ClockMode;
    else if (arg.startsWith("--clock=")) clock = arg.slice("--clock=".length) as ClockMode;
    else rest.push(arg);
  }
  return { rest, ...(tasksPath === undefined ? {} : { tasksPath }), ...(clock === undefined ? {} : { clock }) };
}

function adapter(provider: string, model: string, bench: Benchmark<Task>, seed: number): ModelAdapter {
  if (provider === "mock") return mockAdapter({ seed, ...(bench.definition.mockPolicies ? { policies: bench.definition.mockPolicies } : {}) });
  if (provider === "openrouter") return openrouterAdapter({ model });
  if (provider === "openai") return openaiCompatAdapter({ model });
  throw new Error("--provider must be openrouter, openai, or mock.");
}

/** `run` with the latency summary added to the report. */
async function runCommand(args: string[], bench: Benchmark<Task>): Promise<number> {
  const jsonOutput = args.includes("--json");
  const clean = args.filter((arg) => arg !== "--json");
  const parsed = parseArgs({
    args: clean, strict: true,
    options: {
      model: { type: "string" }, provider: { type: "string" }, concurrency: { type: "string" },
      timeout: { type: "string" }, retries: { type: "string" }, seed: { type: "string" },
      "max-turns": { type: "string" }, "max-tool-calls": { type: "string" }, budget: { type: "string" },
    },
  });
  const model = parsed.values.model;
  const provider = parsed.values.provider;
  if (!model || !provider) {
    console.error("run needs --model and --provider.");
    return 1;
  }
  const seed = Number(parsed.values.seed ?? 1);
  const options: RunOptions = {
    ...(parsed.values.concurrency ? { concurrency: Number(parsed.values.concurrency) } : {}),
    ...(parsed.values.timeout ? { timeoutMs: Number(parsed.values.timeout) } : {}),
    ...(parsed.values.retries ? { retries: Number(parsed.values.retries) } : {}),
    seed,
    ...(parsed.values["max-turns"] ? { maxTurns: Number(parsed.values["max-turns"]) } : {}),
    ...(parsed.values["max-tool-calls"] ? { maxToolCalls: Number(parsed.values["max-tool-calls"]) } : {}),
    ...(parsed.values.budget ? { budgetUsd: Number(parsed.values.budget) } : {}),
  };
  const report = await latencyReport(await runReport(bench, adapter(provider, model, bench, seed), options), bench);
  if (jsonOutput) {
    console.log(JSON.stringify(report));
  } else {
    console.log(renderMarkdown(report));
    const curve = report.latency.deadlineCurve.map((point) => `${point.factor}x ${(point.meanScore * 100).toFixed(0)}%`).join(" ");
    console.log(`Latency: p50 ${report.latency.p50Ms}ms p95 ${report.latency.p95Ms}ms, lateButCorrect ${report.latency.lateButCorrect}, deadline curve ${curve}`);
  }
  return report.rows.some((row) => row.error) ? 2 : 0;
}

async function main(): Promise<number> {
  const { rest, tasksPath, clock } = stripGlobalOptions(process.argv.slice(2));
  if (clock !== undefined && clock !== "measured" && clock !== "declared") {
    console.error("--clock must be measured or declared.");
    return 1;
  }
  if (tasksPath !== undefined && tasksPath.trim() === "") {
    console.error("--tasks needs a tasks.jsonl path.");
    return 1;
  }
  const bench = tasksPath === undefined && clock === undefined
    ? benchmark
    : createLatencyBenchmark({ ...(tasksPath === undefined ? {} : { tasksPath }), ...(clock === undefined ? {} : { clock }) });
  try {
    if (rest[0] === "run") return await runCommand(rest.slice(1), bench);
    return await createCli(bench, { bin: BIN }).main(rest);
  } catch (caught) {
    console.error(caught instanceof Error ? caught.message : String(caught));
    return 2;
  }
}

process.exitCode = await main();
