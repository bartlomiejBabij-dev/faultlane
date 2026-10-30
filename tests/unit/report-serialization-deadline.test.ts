import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RunResult } from "../../src/runner/results";

const control = vi.hoisted(() => ({ terminated: 0, id: 0, worker: undefined as { emit: (event: string, value: unknown) => boolean } | undefined }));
vi.mock("node:worker_threads", async (original) => {
  const real = await original<typeof import("node:worker_threads")>();
  const { EventEmitter } = await import("node:events");
  return { ...real, Worker: class extends EventEmitter {
    constructor() { super(); control.worker = this; }
    postMessage(value: { id: number }) { control.id = value.id; }
    terminate() { control.terminated++; return Promise.resolve(0); }
    unref() { return this; }
  } };
});
import { writeReport } from "../../src/runner/report";

const dirs: string[] = [];
afterEach(async () => { vi.useRealTimers(); control.terminated = 0; control.id = 0; control.worker = undefined; await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
it("times out a stuck serializer without starting report writes, including after a late message", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "faultlane-serialize-")); dirs.push(dir);
  vi.useFakeTimers();
  const outcome = writeReport(dir, {} as RunResult, { serializationMs: 100 }).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(100);
  expect(await outcome).toMatchObject({ code: "EVIDENCE_TIMEOUT", stage: "report-serialize" });
  expect(control.terminated).toBe(1);
  control.worker?.emit("message", { id: control.id, json: "{}", markdown: "late" });
  await Promise.resolve(); await Promise.resolve();
  expect(await readdir(dir)).toEqual([]);
});
it("treats a worker that exits without a result as a serialization failure", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "faultlane-serialize-")); dirs.push(dir);
  const outcome = writeReport(dir, {} as RunResult).catch((error: unknown) => error);
  await Promise.resolve();
  control.worker?.emit("exit", 0);
  expect(await outcome).toMatchObject({ code: "REPORT_SERIALIZATION", stage: "report-serialize" });
  expect(await readdir(dir)).toEqual([]);
});
