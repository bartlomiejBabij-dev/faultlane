import { expect, test } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import catalog from "../../faultlane.catalog.config";
import { startCatalogFixture } from "../../examples/catalog/server";
import { runFaultLane } from "../../src/runner/browser";
import { compareRuns, comparisonExitCode } from "../../src/runner/compare";
import { REPORT_PENDING_FILE } from "../../src/runner/evidence";
import { runResultSchema } from "../../src/runner/results";

test("concurrent independent runs retain unique evidence, counters and comparable reports", async ({}, info) => {
  const fixture = await startCatalogFixture();
  try {
    const input = { ...catalog, baseUrl: fixture.url, reportsDir: info.outputPath("shared-reports") };
    const [first, second] = await Promise.all([runFaultLane(input), runFaultLane(input)]);
    expect(first.directory).not.toBe(second.directory);
    expect(first.run.id).not.toBe(second.run.id);
    for (const result of [first, second]) {
      expect(result.reportPersistence).toEqual({ status: "SAVED", visibility: "READY" });
      expect(result.run.results.map((scenario) => scenario.status)).toEqual(["PASS", "PASS"]);
      expect(result.run.results[1]).toMatchObject({ observedRequests: 2, interceptedRequests: 2, faultedRequests: 1, evidence: { status: "SAVED", captureStatus: "SAVED", persistenceStatus: "SAVED" } });
      expect((await readdir(result.directory))).not.toContain(REPORT_PENDING_FILE);
      const persisted = runResultSchema.parse(JSON.parse(await readFile(path.join(result.directory, "results.json"), "utf8")));
      expect(persisted).toEqual(result.run);
      for (const scenario of result.run.results) {
        expect(scenario.screenshot).toBeTruthy();
        expect((await readFile(path.join(result.directory, scenario.screenshot!))).subarray(1, 4).toString()).toBe("PNG");
      }
    }
    expect(fixture.stats.apiRequests).toBe(4); // baseline + real recovery per run; injected faults stay intercepted.
    const comparison = compareRuns(first.run, second.run);
    expect(comparison.entries.map((entry) => entry.category)).toEqual(["UNCHANGED", "UNCHANGED"]);
    expect(comparisonExitCode(comparison)).toBe(0);
  } finally {
    fixture.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve()));
  }
});
