import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import config from "../../faultlane.config";
import { EvidenceIssue, writeExclusiveFile } from "../../src/runner/evidence";
import { captureEvidence, evidenceFailed, evidenceSaved } from "../../src/runner/steps";
import { exitCode, type RunResult, type ScenarioResult } from "../../src/runner/results";
import { writeReport } from "../../src/runner/report";

const dirs: string[] = [];
async function temp() { const dir = await mkdtemp(path.join(os.tmpdir(), "faultlane-evidence-")); dirs.push(dir); return dir; }
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
function page(screenshot: () => Promise<Buffer>, closed = false): Page {
  return { screenshot, isClosed: () => closed, locator: vi.fn(), getByTestId: vi.fn() } as unknown as Page;
}

describe("evidence persistence", () => {
  it("creates missing directories, verifies PNG and saves it", async () => {
    const file = path.join(await temp(), "missing", "shot.png");
    await captureEvidence(page(async () => png), file, config);
    expect(await readFile(file)).toEqual(png);
  });
  it("reports browser capture errors without leaking raw messages", async () => {
    const file = path.join(await temp(), "shot.png");
    await expect(captureEvidence(page(async () => { throw new Error("secret"); }), file, config)).rejects.toThrow("capture: BROWSER_FAILURE");
    await expect(captureEvidence(page(async () => { throw new Error("secret"); }, true), file, config)).rejects.toThrow("capture: PAGE_CLOSED");
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects an invalid or unwritable destination without administrator privileges", async () => {
    const dir = await temp(); const parent = path.join(dir, "file");
    await writeFile(parent, "original");
    await expect(captureEvidence(page(async () => png), path.join(parent, "shot.png"), config)).rejects.toBeInstanceOf(EvidenceIssue);
    expect(await readFile(parent, "utf8")).toBe("original");
  });
  it("allows exactly one concurrent publisher and never overwrites historical data", async () => {
    const dir = await temp(); const file = path.join(dir, "shot.png");
    const outcomes = await Promise.allSettled([writeExclusiveFile(file, Buffer.from("first")), writeExclusiveFile(file, Buffer.from("second"))]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    const original = await readFile(file);
    await expect(writeExclusiveFile(file, Buffer.from("replacement"))).rejects.toThrow("EEXIST");
    expect(await readFile(file)).toEqual(original);
    expect(await readdir(dir)).toEqual(["shot.png"]);
  });
  it("keeps behavioral FAIL and returns infrastructure exit 2 if capture fails too", () => {
    const result = { status: "FAIL", diagnostics: [] } as unknown as ScenarioResult;
    evidenceSaved(result); evidenceFailed(result, "scenario", new EvidenceIssue("capture", "PAGE_CLOSED")); evidenceSaved(result);
    expect(result.status).toBe("FAIL"); expect(result.evidence).toEqual({ status: "FAILED", captureStatus: "FAILED", persistenceStatus: "SAVED", failures: ["scenario: [EVIDENCE_WRITE] capture: PAGE_CLOSED"] });
    expect(exitCode([result])).toBe(2);
  });
  it("distinguishes capture failure from persistence failure", () => {
    const capture = { status: "FAIL", diagnostics: [] } as unknown as ScenarioResult;
    evidenceFailed(capture, "scenario", new EvidenceIssue("capture", "TIMEOUT"));
    expect(capture.evidence).toMatchObject({ status: "FAILED", captureStatus: "FAILED" });
    const disk = { status: "FAIL", diagnostics: [] } as unknown as ScenarioResult;
    evidenceFailed(disk, "scenario", new EvidenceIssue("write", "ENOSPC"));
    expect(disk.evidence).toMatchObject({ status: "FAILED", captureStatus: "SAVED", persistenceStatus: "FAILED" });
    expect(exitCode([capture, disk])).toBe(2);
  });
  it("never treats skipped required evidence as a successful run", () => {
    expect(exitCode([{ status: "PASS", evidence: { status: "SKIPPED", failures: [] } }])).toBe(2);
  });
  it("rejects serialization before publishing either report", async () => {
    const dir = await temp(); const circular: Record<string, unknown> = {}; circular.self = circular;
    await expect(writeReport(dir, circular as unknown as RunResult)).rejects.toThrow("report-serialize: SERIALIZATION_FAILED");
    expect(await readdir(dir)).toEqual([]);
  });
  it("does not overwrite a historical report and rejects an invalid report directory", async () => {
    const dir = await temp(); const existing = path.join(dir, "report.md");
    await writeFile(existing, "history");
    const run = { id: "20261028T120000000Z-1234abcd", startedAt: "2026-10-28T12:00:00.000Z", durationMs: 0, application: "http://127.0.0.1", apiPattern: "/api", results: [] } as unknown as RunResult;
    await expect(writeReport(dir, run)).rejects.toThrow("EEXIST");
    expect(await readFile(existing, "utf8")).toBe("history");
    const invalid = path.join(dir, "parent"); await writeFile(invalid, "file");
    await expect(writeReport(path.join(invalid, "nested"), run)).rejects.toBeInstanceOf(EvidenceIssue);
    expect(await readFile(invalid, "utf8")).toBe("file");
  });
});
