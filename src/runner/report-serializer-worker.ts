import { parentPort } from "node:worker_threads";
import type { RunResult } from "./results";
import type { Comparison } from "./compare";
import { markdownReport } from "./report";
import { comparisonMarkdown } from "./compare";

parentPort?.on("message", (task: { id: number; kind: "run"; payload: RunResult } | { id: number; kind: "comparison"; payload: Comparison }) => {
  try {
    const json = JSON.stringify(task.payload, null, 2) + "\n";
    const markdown = task.kind === "run" ? markdownReport(task.payload) : comparisonMarkdown(task.payload);
    parentPort?.postMessage({ id: task.id, json, markdown });
  } catch { parentPort?.postMessage({ id: task.id, error: "SERIALIZATION_FAILED" }); }
});
