import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import recovery from "../../faultlane.recovery.config";
import click from "../../faultlane.click.config";
import catalog from "../../faultlane.catalog.config";
import { startCatalogFixture } from "../../examples/catalog/server";
import { runFaultLane } from "../../src/runner/browser";
import { exitCode, runResultSchema } from "../../src/runner/results";
import { defineConfig } from "../../src/runner/config";

const exec = promisify(execFile);
let fixture: Awaited<ReturnType<typeof startCatalogFixture>>;
test.beforeAll(async () => { fixture = await startCatalogFixture(); });
test.afterAll(async () => { fixture.server.closeAllConnections(); await new Promise<void>((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve())); });

test("click journey makes one real request and simulates a server error", async ({}, testInfo) => {
  const { run } = await runFaultLane({ ...click, reportsDir: testInfo.outputPath("reports") });
  expect(run.results.map((r) => r.status)).toEqual(["PASS", "PASS"]);
  expect(run.results[1]).toMatchObject({ observedRequests: 1, interceptedRequests: 1, faultedRequests: 1 });
});

test("demo recovery proves first 500 then a second successful real request", async ({}, testInfo) => {
  const { run, directory } = await runFaultLane({ ...recovery, reportsDir: testInfo.outputPath("reports") });
  expect(run.results.map((r) => r.status)).toEqual(["PASS", "PASS"]);
  const result = run.results[1]!;
  expect(result).toMatchObject({ observedRequests: 2, interceptedRequests: 2, faultedRequests: 1 });
  expect(result.requests).toMatchObject([{ ordinal: 1, outcome: "simulated", status: 500 }, { ordinal: 2, phase: "recovery", outcome: "forwarded", status: 200 }]);
  expect(result.steps?.every((step) => step.status === "PASS")).toBe(true);
  for (const step of result.steps!) {
    expect(step.screenshot).toBeTruthy();
    expect((await readFile(path.join(directory, step.screenshot!))).subarray(1, 4).toString()).toBe("PNG");
  }
  expect(await readFile(path.join(directory, "report.md"), "utf8")).toContain("Journey steps");
});

for (const [bug, code, observed] of [["retry-no-request", "RETRY_NO_REQUEST", 1], ["recovery-error", "ASSERTION_FAILED", 2], ["recovery-loading", "ASSERTION_FAILED", 2]] as const) {
  test(`broken demo ${bug}: real CLI exit 1, diagnostic, steps and screenshot`, async () => {
    let output = "";
    let exit = 0;
    try { output = (await exec(process.execPath, ["--import", "tsx", "src/runner/cli.ts", "run", "--config", "faultlane.recovery-broken.config.ts"], { timeout: 90_000, env: { ...process.env, FAULTLANE_DEMO_BUG: bug } })).stdout; }
    catch (error) { const failure = error as { code: number; stdout: string }; exit = failure.code; output = failure.stdout; }
    expect(exit).toBe(1);
    expect(output).toContain("1 PASS / 1 FAIL / 0 ERROR");
    const directory = output.match(/Report: (.+)/)?.[1]?.trim();
    expect(directory).toBeTruthy();
    const run = runResultSchema.parse(JSON.parse(await readFile(path.join(directory!, "results.json"), "utf8")));
    const result = run.results[1]!;
    expect(result).toMatchObject({ status: "FAIL", code, observedRequests: observed });
    expect(result.failedStep).toBeGreaterThan(0);
    expect(result.steps?.some((step) => step.status === "SKIPPED")).toBe(true);
    expect(result.screenshot).toBe("http-500-failure.png");
    expect((await readFile(path.join(directory!, result.screenshot!))).subarray(1, 4).toString()).toBe("PNG");
  });
}

test("independent catalog uses role/label locators, fill, navigate and real recovery", async ({}, testInfo) => {
  const before = fixture.stats.apiRequests;
  const { run } = await runFaultLane({ ...catalog, baseUrl: fixture.url, reportsDir: testInfo.outputPath("reports") });
  expect(run.results.map((r) => r.status)).toEqual(["PASS", "PASS"]);
  expect(fixture.stats.apiRequests - before).toBe(2); // baseline + recovery; first fault never reaches backend
  expect(run.results[1]).toMatchObject({ observedRequests: 2, faultedRequests: 1 });
  expect(JSON.stringify(run)).not.toContain("stationery"); // fill value not serialized
});

for (const [bug, expectedCode, expectedCount] of [["missing-retry", "ASSERTION_FAILED", 1], ["fake-recovery", "RETRY_NO_REQUEST", 1], ["auto-retry", "REQUEST_BEFORE_RETRY", 2], ["duplicate-retry", "REQUEST_LIMIT_EXCEEDED", 3], ["server-error", "RECOVERY_HTTP_STATUS", 2]] as const) {
  test(`independent app detects ${bug} without false PASS`, async ({}, testInfo) => {
    const { run } = await runFaultLane(defineConfig({ ...catalog, baseUrl: fixture.url, pagePath: `/catalog?bug=${bug}`, actions: catalog.actions?.filter((a) => a.type !== "navigate"), reportsDir: testInfo.outputPath("reports"), timeouts: { ...catalog.timeouts, assertionMs: 500, requestMs: 1000 } }));
    expect(run.results[0]?.status).toBe("PASS");
    expect(run.results[1]).toMatchObject({ status: "FAIL", code: expectedCode, observedRequests: expectedCount });
    expect(exitCode(run.results)).toBe(1);
  });
}

test("wrong API coverage is ERROR and remaining expectations are skipped", async ({}, testInfo) => {
  const { run } = await runFaultLane(defineConfig({ ...catalog, baseUrl: fixture.url, api: { pathname: "/api/wrong", method: "GET" }, reportsDir: testInfo.outputPath("reports"), timeouts: { ...catalog.timeouts, requestMs: 600 } }), { only: "baseline" });
  expect(run.results[0]).toMatchObject({ status: "ERROR", code: "API_NOT_OBSERVED", interceptedRequests: 0 });
  expect(run.results[0]?.steps?.some((step) => step.status === "SKIPPED")).toBe(true);
  expect(exitCode(run.results)).toBe(2);
});

test("missing actionable UI is FAIL, external redirect is ERROR", async ({}, testInfo) => {
  const missing = await runFaultLane(defineConfig({ ...catalog, baseUrl: fixture.url, actions: [{ type: "click", locator: { by: "role", role: "button", name: "Missing button" }, timeoutMs: 200 }], reportsDir: testInfo.outputPath("missing") }), { only: "baseline" });
  expect(missing.run.results[0]).toMatchObject({ status: "FAIL", code: "ACTION_EXPECTATION_FAILED" });
  const redirect = await runFaultLane({ ...catalog, baseUrl: fixture.url, pagePath: "/redirect", reportsDir: testInfo.outputPath("redirect") }, { only: "baseline" });
  expect(redirect.run.results[0]?.status).toBe("ERROR");
  expect(redirect.run.results[0]?.interceptedRequests).toBe(0);
});
