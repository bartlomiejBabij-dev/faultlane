import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exitCode, runResultSchema, type RunResult } from "../../src/runner/results";
import { markdownReport, writeReport } from "../../src/runner/report";
import { listReports, readReportFile } from "../../src/lib/report-store";

const temporary: string[] = [];
async function temp() { const dir = await mkdtemp(path.join(os.tmpdir(), "faultlane-test-")); temporary.push(dir); return dir; }
afterEach(async () => { await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const sample: RunResult = {
  schemaVersion: 1, id: "20261026T120000000Z-1234abcd", startedAt: "2026-10-26T12:00:00.000Z", application: "http://127.0.0.1:3000/demo", apiPattern: "/api/demo/projects", durationMs: 100,
  results: [{ id: "http-500", status: "FAIL", durationMs: 100, interceptedRequests: 1, assertions: [{ expected: "loading is hidden", observed: "loading remained visible", passed: false, phase: "after-response" }], observation: "loading remained visible", suggestion: "Inspect the state transition; not a proven cause.", screenshot: "http-500-failure.png", loadingScreenshot: null, diagnostics: [] }],
};

describe("result logic and reports", () => {
  it("distinguishes pass, failed assertions, infrastructure errors and empty runs", () => {
    expect(exitCode([{ status: "PASS" }])).toBe(0);
    expect(exitCode([{ status: "PASS" }, { status: "FAIL" }])).toBe(1);
    expect(exitCode([{ status: "FAIL" }, { status: "ERROR" }])).toBe(2);
    expect(exitCode([])).toBe(2);
  });
  it("writes parseable JSON and useful Markdown with relative evidence and observations", async () => {
    const directory = await temp();
    await writeReport(directory, sample);
    const saved = runResultSchema.parse(JSON.parse(await readFile(path.join(directory, "results.json"), "utf8")));
    expect(saved).toEqual(sample);
    const markdown = await readFile(path.join(directory, "report.md"), "utf8");
    expect(markdown).toContain("0 PASS / 1 FAIL / 0 ERROR");
    expect(markdown).toContain("./http-500-failure.png");
    expect(markdown).toContain("Expected: loading is hidden");
    expect(markdown).toContain("Observed: loading remained visible");
    expect(markdown).toContain("not a proven root cause");
  });
  it("escapes injected Markdown content", () => {
    expect(markdownReport({ ...sample, application: "<script>alert(1)</script>" })).not.toContain("<script>");
  });
});

describe("safe report reader", () => {
  it("returns only valid completed runs and ignores malformed JSON", async () => {
    const root = await temp();
    await writeReport(path.join(root, sample.id), sample);
    const invalidId = "20261026T120001000Z-1234abcd";
    await mkdir(path.join(root, invalidId));
    await writeFile(path.join(root, invalidId, "results.json"), "not-json");
    const result = await listReports(root);
    expect(result.runs).toEqual([sample]);
    expect(result.skipped).toBe(1);
    expect(JSON.parse((await readReportFile(root, sample.id, "results.json")).toString())).toEqual(sample);
  });
  it("rejects traversal and arbitrary filenames", async () => {
    const root = await temp();
    await expect(readReportFile(root, "../../secret", "results.json")).rejects.toThrow("Invalid report path");
    await expect(readReportFile(root, sample.id, "../secret.txt")).rejects.toThrow("Invalid report path");
    await expect(readReportFile(root, sample.id, "secret.txt")).rejects.toThrow("Invalid report path");
  });
  it("rejects a report directory junction that escapes the root", async () => {
    const root = await temp();
    const outside = await temp();
    await writeFile(path.join(outside, "results.json"), JSON.stringify(sample));
    await symlink(outside, path.join(root, sample.id), process.platform === "win32" ? "junction" : "dir");
    await expect(readReportFile(root, sample.id, "results.json")).rejects.toThrow("escapes");
  });
  it("represents missing report directories as an empty state", async () => {
    expect(await listReports(path.join(await temp(), "missing"))).toEqual({ runs: [], skipped: 0, unavailable: false });
  });
});
