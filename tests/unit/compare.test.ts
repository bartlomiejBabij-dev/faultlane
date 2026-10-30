import { describe, expect, it } from "vitest";
import config from "../../faultlane.config";
import { compareRuns, comparisonExitCode, comparisonMarkdown, inspectComparisonEvidence, readComparisonInput, scenarioIdentity } from "../../src/runner/compare";
import type { RunResult, ScenarioResult } from "../../src/runner/results";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const identity = scenarioIdentity(config, { id: "baseline", ...config.baseline });
function result(status: ScenarioResult["status"], id: ScenarioResult["id"] = "baseline"): ScenarioResult {
  return { id, status, identity, durationMs: 1, interceptedRequests: 1, assertions: [], observation: "", suggestion: "", screenshot: null, loadingScreenshot: null, diagnostics: [], evidence: { status: "SAVED", failures: [] } };
}
function run(...results: ScenarioResult[]): RunResult {
  return { schemaVersion: 2, id: "20261028T120000000Z-1234abcd", startedAt: "2026-10-28T12:00:00.000Z", durationMs: 1, application: "http://127.0.0.1:3000/demo", apiPattern: "/api/projects", results };
}
describe("regression comparison", () => {
  it.each([["PASS", "FAIL", "REGRESSION", 1], ["FAIL", "PASS", "IMPROVEMENT", 0], ["PASS", "PASS", "UNCHANGED", 0], ["ERROR", "PASS", "IMPROVEMENT", 0], ["PASS", "ERROR", "INCOMPARABLE", 2]] as const)("%s to %s", (before, after, category, code) => {
    const comparison = compareRuns(run(result(before)), run(result(after)));
    expect(comparison.entries[0]?.category).toBe(category); expect(comparisonExitCode(comparison)).toBe(code);
  });
  it("distinguishes new and removed scenarios", () => {
    const comparison = compareRuns(run(result("PASS"), result("PASS", "http-500")), run(result("PASS"), result("PASS", "http-429")));
    expect(comparison.entries.map((entry) => entry.category)).toEqual(["UNCHANGED", "REMOVED", "NEW"]);
  });
  it("never guesses equivalence for historical or changed identity", () => {
    const old = result("PASS"); delete old.identity;
    expect(compareRuns(run(old), run(result("FAIL"))).entries[0]?.category).toBe("INCOMPARABLE");
    expect(compareRuns(run(result("PASS")), run({ ...result("FAIL"), identity: "f".repeat(64) })).entries[0]?.category).toBe("INCOMPARABLE");
  });
  it("records evidence change and never includes arbitrary screenshot paths", () => {
    const current = result("FAIL"); current.evidence = { status: "FAILED", failures: ["capture: PAGE_CLOSED"] };
    const comparison = compareRuns(run(result("PASS")), run(current));
    expect(comparison.entries[0]).toMatchObject({ baseEvidence: "SAVED", headEvidence: "FAILED" });
    expect(comparisonMarkdown(comparison)).toContain("REGRESSION (1)");
    expect(comparisonExitCode(comparison)).toBe(2);
  });
  it("reports changed endpoint coverage without assuming changed identities are equivalent", () => {
    const endpoint = (expectedRequests: number, interceptedRequests: number) => ({ id: "orders", expectedRequests, interceptedRequests }) as NonNullable<ScenarioResult["endpoints"]>[number];
    const before = { ...result("PASS"), endpoints: [endpoint(1, 1)] };
    const after = { ...result("FAIL"), identity: "e".repeat(64), endpoints: [endpoint(2, 1)] };
    const comparison = compareRuns(run(before), run(after));
    expect(comparison.entries[0]?.category).toBe("INCOMPARABLE");
    expect(comparison.entries[0]?.coverage).toEqual([{ id: "orders", baseExpected: 1, headExpected: 2, baseActual: 1, headActual: 1 }]);
  });
  it("reports missing input and malformed JSON", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "faultlane-compare-"));
    try {
      await expect(readComparisonInput(path.join(dir, "missing.json"))).rejects.toThrow();
      const file = path.join(dir, "bad.json"); await writeFile(file, "{");
      await expect(readComparisonInput(file)).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("checks whether referenced screenshots still exist and have PNG signatures", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "faultlane-compare-"));
    try {
      const before = run({ ...result("PASS"), screenshot: "baseline.png" });
      const after = run({ ...result("PASS"), screenshot: "http-500.png" });
      await writeFile(path.join(dir, "baseline.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const comparison = compareRuns(before, after);
      await inspectComparisonEvidence(comparison, before, after, path.join(dir, "a.json"), path.join(dir, "b.json"));
      expect(comparison.entries[0]).toMatchObject({ baseScreenshot: "AVAILABLE: baseline.png", headScreenshot: "UNAVAILABLE" });
      expect(comparisonExitCode(comparison)).toBe(2);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
