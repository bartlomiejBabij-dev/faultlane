import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import config from "../../faultlane.config";
import { runFaultLane } from "../../src/runner/browser";
import { defineConfig } from "../../src/runner/config";
import { exitCode, runResultSchema } from "../../src/runner/results";

const exec = promisify(execFile);
const cli = path.resolve("src/runner/cli.ts");

test("all six scenarios exercise the browser and save real evidence", async ({}, testInfo) => {
  const { run, directory } = await runFaultLane({ ...config, reportsDir: testInfo.outputPath("reports") });
  expect(run.results.map((r) => [r.id, r.status])).toEqual([["baseline", "PASS"], ["http-500", "PASS"], ["http-429", "PASS"], ["slow", "PASS"], ["network", "PASS"], ["empty", "PASS"]]);
  expect(exitCode(run.results)).toBe(0);
  for (const result of run.results) {
    expect(result.interceptedRequests).toBeGreaterThan(0);
    expect(result.assertions.length).toBeGreaterThan(0);
    const png = await readFile(path.join(directory, result.screenshot!));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  }
  expect(run.results.find((r) => r.id === "slow")?.loadingScreenshot).toBe("slow-loading.png");
  expect(runResultSchema.parse(JSON.parse(await readFile(path.join(directory, "results.json"), "utf8")))).toEqual(run);
  expect(await readFile(path.join(directory, "report.md"), "utf8")).toContain("6 PASS / 0 FAIL / 0 ERROR");
});

test("CLI broken mode returns 1 and creates a failure screenshot and report", async () => {
  let code = 0;
  let stdout = "";
  try {
    const result = await exec(process.execPath, ["--import", "tsx", cli, "run", "--config", "faultlane.broken.config.ts"], { timeout: 90_000, maxBuffer: 1_000_000 });
    stdout = result.stdout;
  } catch (error) {
    const failure = error as { code: number; stdout: string };
    code = failure.code;
    stdout = failure.stdout;
  }
  expect(code).toBe(1);
  expect(stdout).toContain("1 PASS / 1 FAIL / 0 ERROR");
  const directory = stdout.match(/Report: (.+)/)?.[1]?.trim();
  expect(directory).toBeTruthy();
  const run = runResultSchema.parse(JSON.parse(await readFile(path.join(directory!, "results.json"), "utf8")));
  expect(run.results[1]?.observation).toContain("loading");
  expect(run.results[1]?.assertions.some((a) => !a.passed)).toBe(true);
  expect(await readdir(directory!)).toContain("http-500-failure.png");
});

test("missing API interception is ERROR even when the page shows valid data", async ({}, testInfo) => {
  const { run } = await runFaultLane(defineConfig({ ...config, reportsDir: testInfo.outputPath("reports"), api: { pathname: "/api/does-not-exist", method: "GET" }, timeouts: { ...config.timeouts, requestMs: 1000 } }), { only: "baseline" });
  expect(run.results[0]?.status).toBe("ERROR");
  expect(run.results[0]?.interceptedRequests).toBe(0);
  expect(run.results[0]?.observation).toContain("No matching API request");
  expect(exitCode(run.results)).toBe(2);
});

test("a loaded page with an unsatisfied positive assertion is FAIL", async ({}, testInfo) => {
  const { run } = await runFaultLane(defineConfig({ ...config, reportsDir: testInfo.outputPath("reports"), baseline: { assertions: [{ testId: "nonexistent-button", state: "visible" }] }, timeouts: { ...config.timeouts, assertionMs: 500 } }), { only: "baseline" });
  expect(run.results[0]?.status).toBe("FAIL");
  expect(run.results[0]?.interceptedRequests).toBeGreaterThan(0);
});

test("CLI rejects an unknown scenario with exit code 2", async () => {
  await expect(exec(process.execPath, ["--import", "tsx", cli, "run", "--scenario", "unknown"], { timeout: 30_000 })).rejects.toMatchObject({ code: 2 });
});

test("results dashboard serves reports, validates paths and fits mobile", async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/results");
  await expect(page.getByRole("heading", { name: "Find failures first." })).toBeVisible();
  await expect(page.getByTestId("run").first()).toBeVisible();
  const jsonLink = page.getByRole("link", { name: "JSON ↓" }).first();
  const jsonResponse = await request.get((await jsonLink.getAttribute("href"))!);
  expect(jsonResponse.status()).toBe(200);
  expect(runResultSchema.safeParse(await jsonResponse.json()).success).toBe(true);
  const screenshotLink = page.getByRole("link", { name: "Open browser evidence ↗" }).first();
  const shot = await request.get((await screenshotLink.getAttribute("href"))!);
  expect(shot.headers()["content-type"]).toBe("image/png");
  const invalid = await request.get("/api/reports/invalid/package.json");
  expect(invalid.status()).toBe(404);
  await page.screenshot({ path: testInfo.outputPath("results-desktop.png"), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Find failures first." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("results-mobile.png"), fullPage: false });
  expect(errors).toEqual([]);
});
