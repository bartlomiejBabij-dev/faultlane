import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import config from "../../faultlane.config";
import type { RunResult } from "../../src/runner/results";

const fault = vi.hoisted(() => ({
  mkdirNever: false, writeCode: "", linkCode: "", cleanupCode: "",
  writeGate: undefined as Promise<void> | undefined, writeStarted: undefined as (() => void) | undefined, temporaryRemoved: undefined as (() => void) | undefined,
  linkGate: undefined as Promise<void> | undefined, linkStarted: undefined as (() => void) | undefined, linkCompleted: undefined as (() => void) | undefined,
  removeGate: undefined as Promise<void> | undefined,
  markerGate: undefined as Promise<void> | undefined, markerStarted: undefined as (() => void) | undefined, markerRemoved: undefined as (() => void) | undefined, markerCode: "",
  targetRemoved: undefined as (() => void) | undefined, lateCleanup: undefined as (() => void) | undefined, targetWasRemoved: false, linkWasStarted: false,
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  const failure = (code: string) => Object.assign(new Error("synthetic filesystem failure"), { code });
  return { ...fs,
    mkdir: async (...args: Parameters<typeof fs.mkdir>) => {
      if (fault.mkdirNever) await new Promise<never>(() => {});
      return await fs.mkdir(...args);
    },
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (!fault.writeCode && !fault.writeGate) return handle;
      return new Proxy(handle, { get(target, property) {
        if (property === "writeFile") return async (data: Buffer, options: { signal?: AbortSignal }) => {
          if (fault.writeCode) throw failure(fault.writeCode);
          fault.writeStarted?.(); await fault.writeGate;
          await target.writeFile(data, options);
        };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      } });
    },
    link: async (source: string, target: string) => {
      if (fault.linkCode) throw failure(fault.linkCode);
      if (fault.linkGate && path.basename(target) === "results.json") { fault.linkWasStarted = true; fault.linkStarted?.(); await fault.linkGate; }
      await fs.link(source, target);
      if (path.basename(target) === "results.json") fault.linkCompleted?.();
    },
    unlink: async (filename: string) => {
      if (fault.cleanupCode && filename.endsWith(".tmp")) throw failure(fault.cleanupCode);
      if (path.basename(filename) === ".faultlane-report-pending") {
        if (fault.markerCode) throw failure(fault.markerCode);
        if (fault.markerGate) { fault.markerStarted?.(); await fault.markerGate; }
      }
      if (fault.removeGate && path.basename(filename) === "results.json") await fault.removeGate;
      await fs.unlink(filename);
      if (path.basename(filename) === ".faultlane-report-pending") fault.markerRemoved?.();
      if (path.basename(filename) === "results.json") { fault.targetWasRemoved = true; fault.targetRemoved?.(); }
      else if (fault.targetWasRemoved && filename.endsWith(".tmp")) fault.lateCleanup?.();
      else if (fault.linkWasStarted && filename.endsWith(".tmp")) fault.lateCleanup?.();
      else if (fault.writeGate && filename.endsWith(".tmp")) fault.temporaryRemoved?.();
    },
  };
});

import { EvidenceIssue, REPORT_PENDING_FILE, assertReportPublished, withEvidenceDeadline, writeExclusiveFile } from "../../src/runner/evidence";
import { captureEvidence } from "../../src/runner/steps";
import { writeReport } from "../../src/runner/report";
import { listReports } from "../../src/lib/report-store";
import { readComparisonInput } from "../../src/runner/compare";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const dirs: string[] = [];
async function temp() { const dir = await mkdtemp(path.join(os.tmpdir(), "faultlane-deadline-")); dirs.push(dir); return dir; }
afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks();
  Object.assign(fault, { mkdirNever: false, writeCode: "", linkCode: "", cleanupCode: "", writeGate: undefined, writeStarted: undefined, temporaryRemoved: undefined, linkGate: undefined, linkStarted: undefined, linkCompleted: undefined, removeGate: undefined, markerGate: undefined, markerStarted: undefined, markerRemoved: undefined, markerCode: "", targetRemoved: undefined, lateCleanup: undefined, targetWasRemoved: false, linkWasStarted: false });
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("bounded evidence lifecycle", () => {
  it("returns a stable timeout when a filesystem operation never settles", async () => {
    const dir = await temp(); fault.mkdirNever = true; vi.useFakeTimers();
    const outcome = writeExclusiveFile(path.join(dir, "shot.png"), Buffer.from("x"), { timeoutMs: 100, cleanupMs: 20 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(120);
    expect(await outcome).toMatchObject({ code: "EVIDENCE_TIMEOUT", stage: "directory" });
    expect(await readdir(dir)).toEqual([]);
  });
  it("ignores a late screenshot and never begins its file write", async () => {
    const dir = await temp(); const gate = deferred(); const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const page = { screenshot: async () => { await gate.promise; return png; }, isClosed: () => false, locator: vi.fn(), getByTestId: vi.fn() } as unknown as Page;
    vi.useFakeTimers();
    const outcome = captureEvidence(page, path.join(dir, "shot.png"), config, 100).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(100);
    expect(await outcome).toMatchObject({ code: "EVIDENCE_TIMEOUT", stage: "capture" });
    gate.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(await readdir(dir)).toEqual([]);
  });
  it("does not publish a temporary write that settles after timeout", async () => {
    const dir = await temp(); const gate = deferred(); const started = deferred(); const removed = deferred();
    fault.writeGate = gate.promise; fault.writeStarted = started.resolve; fault.temporaryRemoved = removed.resolve;
    vi.useFakeTimers();
    const outcome = writeExclusiveFile(path.join(dir, "shot.png"), Buffer.from("data"), { timeoutMs: 100, cleanupMs: 20 }).catch((error: unknown) => error);
    await started.promise; await vi.advanceTimersByTimeAsync(120);
    expect(await outcome).toMatchObject({ code: "EVIDENCE_TIMEOUT", stage: "write" });
    gate.resolve(); await removed.promise;
    expect(await readdir(dir)).toEqual([]);
  });
  it("reports ENOSPC, unsupported hard links, and cleanup failure without overwriting", async () => {
    const dir = await temp(); const target = path.join(dir, "shot.png");
    fault.writeCode = "ENOSPC";
    await expect(writeExclusiveFile(target, Buffer.from("data"))).rejects.toThrow("write: ENOSPC");
    expect(await readdir(dir)).toEqual([]);
    fault.writeCode = ""; fault.linkCode = "EOPNOTSUPP";
    await expect(writeExclusiveFile(target, Buffer.from("data"))).rejects.toMatchObject({ code: "EVIDENCE_UNSUPPORTED", stage: "publish" });
    expect(await readdir(dir)).toEqual([]);
    fault.linkCode = ""; fault.cleanupCode = "EACCES";
    await expect(writeExclusiveFile(target, Buffer.from("data"))).rejects.toThrow("cleanup: temporary EACCES");
    expect(await readFile(target, "utf8")).toBe("data");
  });
  it("quarantines a report if publication finishes after its deadline", async () => {
    const root = await temp(); const id = "20261030T120000000Z-1234abcd"; const dir = path.join(root, id);
    const run: RunResult = { schemaVersion: 2, id, startedAt: "2026-10-30T12:00:00.000Z", durationMs: 1, application: "http://127.0.0.1/demo", apiPattern: "/api", results: [{ id: "baseline", status: "PASS", durationMs: 1, interceptedRequests: 1, assertions: [], observation: "ok", suggestion: "", screenshot: null, loadingScreenshot: null, diagnostics: [] }] };
    const gate = deferred(); const started = deferred(); const linked = deferred(); const removeGate = deferred(); const removed = deferred(); const cleaned = deferred();
    fault.linkGate = gate.promise; fault.linkStarted = started.resolve; fault.linkCompleted = linked.resolve; fault.removeGate = removeGate.promise; fault.targetRemoved = removed.resolve; fault.lateCleanup = cleaned.resolve;
    vi.useFakeTimers();
    const outcome = writeReport(dir, run, { timeoutMs: 100, cleanupMs: 20 }).catch((error: unknown) => error);
    await started.promise;
    await vi.advanceTimersByTimeAsync(120);
    expect(await outcome).toMatchObject({ code: "EVIDENCE_TIMEOUT", stage: "publish" });
    expect((await readdir(dir))).toContain(REPORT_PENDING_FILE);
    await expect(assertReportPublished(dir)).rejects.toThrow("PENDING");
    gate.resolve(); await linked.promise;
    expect(JSON.parse(await readFile(path.join(dir, "results.json"), "utf8"))).toMatchObject({ results: [{ status: "PASS" }] });
    expect(await listReports(root)).toMatchObject({ runs: [], skipped: 1 });
    await expect(readComparisonInput(path.join(dir, "results.json"))).rejects.toThrow("PENDING");
    removeGate.resolve(); await removed.promise; await cleaned.promise;
    await expect(assertReportPublished(dir)).rejects.toThrow("PENDING");
    expect((await readdir(dir))).not.toContain("results.json");
  });
  it("does not remove a pre-existing file when a timed-out publication later collides", async () => {
    const dir = await temp(); const target = path.join(dir, "results.json");
    const gate = deferred(); const started = deferred(); const cleaned = deferred();
    fault.linkGate = gate.promise; fault.linkStarted = started.resolve; fault.lateCleanup = cleaned.resolve;
    vi.useFakeTimers();
    const outcome = writeExclusiveFile(target, Buffer.from("new"), { timeoutMs: 100, cleanupMs: 20 }).catch((error: unknown) => error);
    await started.promise; await vi.advanceTimersByTimeAsync(120);
    expect(await outcome).toMatchObject({ code: "EVIDENCE_TIMEOUT", stage: "publish" });
    await (await import("node:fs/promises")).writeFile(target, "historical", { flag: "wx" });
    gate.resolve(); await cleaned.promise;
    expect(await readFile(target, "utf8")).toBe("historical");
    expect(await readdir(dir)).toEqual(["results.json"]);
  });
  it("warns if visibility cleanup times out after both reports were saved", async () => {
    const root = await temp(); const id = "20261030T120001000Z-1234abcd"; const dir = path.join(root, id);
    const run: RunResult = { schemaVersion: 2, id, startedAt: "2026-10-30T12:00:01.000Z", durationMs: 1, application: "http://127.0.0.1/demo", apiPattern: "/api", results: [{ id: "baseline", status: "PASS", durationMs: 1, interceptedRequests: 1, assertions: [], observation: "ok", suggestion: "", screenshot: null, loadingScreenshot: null, diagnostics: [] }] };
    const gate = deferred(); const started = deferred(); const removed = deferred();
    fault.markerGate = gate.promise; fault.markerStarted = started.resolve; fault.markerRemoved = removed.resolve;
    vi.useFakeTimers();
    const outcome = writeReport(dir, run, { timeoutMs: 100, cleanupMs: 20 });
    await started.promise; await vi.advanceTimersByTimeAsync(20);
    expect(await outcome).toEqual({ status: "SAVED", visibility: "PENDING", warning: "REPORT_VISIBILITY_TIMEOUT" });
    expect((await readdir(dir))).toEqual(expect.arrayContaining(["report.md", "results.json", REPORT_PENDING_FILE]));
    expect(await listReports(root)).toMatchObject({ runs: [], skipped: 1 });
    gate.resolve(); await removed.promise;
    expect((await listReports(root)).runs[0]?.id).toBe(id);
  });
  it("retains quarantine when visibility cleanup fails", async () => {
    const dir = await temp(); const run: RunResult = { schemaVersion: 2, id: "20261030T120002000Z-1234abcd", startedAt: "2026-10-30T12:00:02.000Z", durationMs: 1, application: "http://127.0.0.1/demo", apiPattern: "/api", results: [{ id: "baseline", status: "PASS", durationMs: 1, interceptedRequests: 1, assertions: [], observation: "ok", suggestion: "", screenshot: null, loadingScreenshot: null, diagnostics: [] }] };
    fault.markerCode = "EACCES";
    await expect(writeReport(dir, run)).rejects.toThrow("report-visibility: EACCES");
    expect((await readdir(dir))).toContain(REPORT_PENDING_FILE);
    await expect(assertReportPublished(dir)).rejects.toThrow("PENDING");
  });
  it("consumes late failures after a deadline", async () => {
    vi.useFakeTimers(); const gate = deferred();
    const outcome = withEvidenceDeadline("capture", async () => { await gate.promise; throw new Error("late secret"); }, 50).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(50);
    expect(await outcome).toBeInstanceOf(EvidenceIssue);
    gate.resolve(); await Promise.resolve(); await Promise.resolve();
  });
  it("rejects late completion even when the timer callback has not run", async () => {
    const gate = deferred();
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(101);
    const outcome = withEvidenceDeadline("capture", async () => { await gate.promise; return "late"; }, 100).catch((error: unknown) => error);
    gate.resolve();
    expect(await outcome).toMatchObject({ code: "EVIDENCE_TIMEOUT", stage: "capture" });
  });
});
