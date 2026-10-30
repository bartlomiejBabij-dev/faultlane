import { Worker } from "node:worker_threads";
import type { RunResult } from "./results";
import type { Comparison } from "./compare";
import { EVIDENCE_IO_DEADLINE_MS, EvidenceIssue, withEvidenceDeadline } from "./evidence";

export type SerializedReport = { json: string; markdown: string };
type Pending = { resolve: (value: SerializedReport) => void; reject: (error: EvidenceIssue) => void };
type WorkerState = { worker: Worker; requests: Map<number, Pending>; nextId: number };
let current: WorkerState | undefined;

function failRequests(state: WorkerState): void {
  if (current === state) current = undefined;
  for (const request of state.requests.values()) request.reject(new EvidenceIssue("report-serialize", "SERIALIZATION_FAILED"));
  state.requests.clear();
}

function getWorker(): WorkerState {
  if (current) return current;
  const source = import.meta.url.endsWith(".ts");
  const worker = new Worker(new URL(source ? "./report-serializer-worker.ts" : "./report-serializer-worker.js", import.meta.url), source ? { execArgv: ["--import", "tsx"] } : {});
  const state: WorkerState = { worker, requests: new Map(), nextId: 0 };
  worker.on("message", (value: unknown) => {
    if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "number") return;
    const request = state.requests.get(value.id);
    if (!request) return; // A timed-out request can never resume publication.
    state.requests.delete(value.id);
    if ("json" in value && "markdown" in value && typeof value.json === "string" && typeof value.markdown === "string") request.resolve({ json: value.json, markdown: value.markdown });
    else request.reject(new EvidenceIssue("report-serialize", "SERIALIZATION_FAILED"));
  });
  worker.on("error", () => failRequests(state));
  worker.on("exit", () => failRequests(state));
  worker.unref();
  current = state;
  return state;
}

async function serialize(kind: "run" | "comparison", payload: RunResult | Comparison, timeoutMs: number): Promise<SerializedReport> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new EvidenceIssue("report-serialize", "TIMEOUT");
  let state: WorkerState | undefined;
  let id: number | undefined;
  try {
    return await withEvidenceDeadline("report-serialize", () => {
      state = getWorker();
      const active = state;
      id = ++active.nextId;
      const requestId = id;
      return new Promise<SerializedReport>((resolve, reject) => {
        active.requests.set(requestId, { resolve, reject });
        try { active.worker.postMessage({ id: requestId, kind, payload }); }
        catch { active.requests.delete(requestId); reject(new EvidenceIssue("report-serialize", "SERIALIZATION_FAILED")); }
      });
    }, timeoutMs, () => {
      if (!state) return;
      failRequests(state);
      void state.worker.terminate().catch(() => undefined);
    });
  } catch (error) { throw error instanceof EvidenceIssue ? error : new EvidenceIssue("report-serialize", "SERIALIZATION_FAILED"); }
  finally { if (state && id !== undefined) state.requests.delete(id); }
}

export async function serializeReport(run: RunResult, timeoutMs = EVIDENCE_IO_DEADLINE_MS): Promise<SerializedReport> { return await serialize("run", run, timeoutMs); }
export async function serializeComparison(comparison: Comparison, timeoutMs = EVIDENCE_IO_DEADLINE_MS): Promise<SerializedReport> { return await serialize("comparison", comparison, timeoutMs); }
