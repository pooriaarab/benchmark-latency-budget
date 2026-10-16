import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  MAX_TOOL_LOG_ENTRIES, mockAdapter, openrouterAdapter, run as runBenchmark,
  type Benchmark, type ModelAdapter, type Task, type Trace,
} from "benchmark-core";
import { benchmark } from "./benchmark.js";
import { latencyReport } from "./index.js";
import { serverSubmission, submissionLatency } from "./server.js";

const TOOLS = [
  { name: "list_tasks", description: "List benchmark task ids and prompts.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_task", description: "Get one benchmark task.", inputSchema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"], additionalProperties: false } },
  { name: "score_answer", description: "Score a trace with the deterministic benchmark grader. Returns a latency timing block; self-reported measured turn times are ignored.", inputSchema: { type: "object", properties: { taskId: { type: "string" }, submission: { type: "object" }, seed: { type: "number" } }, required: ["taskId", "submission"], additionalProperties: false } },
  { name: "run_benchmark", description: "Run every task through a model and return the report with the latency summary (p50/p95, lateButCorrect, deadline curve).", inputSchema: { type: "object", properties: { model: { type: "string" }, provider: { type: "string", enum: ["openrouter", "mock"] }, seed: { type: "number" } }, required: ["model"], additionalProperties: false } },
  { name: "get_provenance", description: "Get benchmark data provenance.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
];

function content(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

function args(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * MCP stdio server over the five benchmark tools. `run_benchmark` returns the
 * report wrapped in `latencyReport` (p50/p95, lateButCorrect, deadline curve)
 * and accepts `provider: "mock"` for offline runs; `score_answer` strips
 * self-reported measured turn times and adds a `latency` timing block.
 */
export function createMcpServer(bench: Benchmark<Task> = benchmark): Server {
  const server = new Server({ name: bench.definition.id, version: bench.definition.version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS.map((tool) => ({ ...tool })) }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const input = args(request.params.arguments);
      if (request.params.name === "list_tasks") return content({ tasks: await bench.listTasks() });
      if (request.params.name === "get_task") {
        if (typeof input["taskId"] !== "string") return content({ error: "taskId is required." }, true);
        const task = await bench.getTask(input["taskId"]);
        return task ? content({ task }) : content({ error: "Task not found." }, true);
      }
      if (request.params.name === "score_answer") {
        if (typeof input["taskId"] !== "string" || !input["submission"] || typeof input["submission"] !== "object" || Array.isArray(input["submission"])) return content({ error: "taskId and submission are required." }, true);
        const submittedLog = Reflect.get(input["submission"], "toolLog");
        if (Array.isArray(submittedLog) && submittedLog.length > MAX_TOOL_LOG_ENTRIES) return content({ error: `toolLog may not exceed ${MAX_TOOL_LOG_ENTRIES} entries.` }, true);
        const task = await bench.getTask(input["taskId"]);
        if (!task) return content({ error: "Task not found." }, true);
        const seed = typeof input["seed"] === "number" ? input["seed"] : 1;
        const submission = serverSubmission(input["submission"] as Trace);
        return content({ taskId: task.id, ...await bench.score(task, submission, { seed }), latency: submissionLatency(task, submission, seed) });
      }
      if (request.params.name === "run_benchmark") {
        if (typeof input["model"] !== "string") return content({ error: "model is required." }, true);
        const provider = input["provider"] ?? "openrouter";
        const seed = typeof input["seed"] === "number" ? input["seed"] : 1;
        let adapter: ModelAdapter;
        if (provider === "mock") {
          adapter = mockAdapter({ seed, ...(bench.definition.mockPolicies ? { policies: bench.definition.mockPolicies } : {}) });
        } else if (provider === "openrouter") {
          if (!process.env.OPENROUTER_API_KEY) return content({ error: "OPENROUTER_API_KEY is required to run a benchmark." }, true);
          adapter = openrouterAdapter({ model: input["model"] });
        } else {
          return content({ error: "provider must be openrouter or mock." }, true);
        }
        return content(await latencyReport(await runBenchmark(bench, adapter, { seed }), bench));
      }
      if (request.params.name === "get_provenance") return content({ provenance: bench.definition.provenance });
      return content({ error: `Unknown tool: ${request.params.name}` }, true);
    } catch (caught) {
      return content({ error: caught instanceof Error ? caught.message : "Unknown error." }, true);
    }
  });
  return server;
}

export async function startMcp(bench: Benchmark<Task> = benchmark): Promise<void> {
  await createMcpServer(bench).connect(new StdioServerTransport());
}
