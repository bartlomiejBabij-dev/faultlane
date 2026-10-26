import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { checkAssertions } from "./assertions";
import { configSchema, isLoopbackUrl, matchesApi, selectScenarios, type FaultLaneConfig, type Scenario } from "./config";
import { forwardLocal, simulate } from "./scenarios";
import { type RunResult, type ScenarioResult } from "./results";
import { writeReport } from "./report";

class ExecutionError extends Error {}

function emptyResult(scenario: Scenario): ScenarioResult {
  return { id: scenario.id, status: "ERROR", durationMs: 0, interceptedRequests: 0, assertions: [], observation: "Scenario did not finish.", suggestion: "Inspect the local server, API pathname and configured timeouts.", screenshot: null, loadingScreenshot: null, diagnostics: [] };
}

async function screenshot(page: Page, filename: string, config: FaultLaneConfig) {
  await page.screenshot({ path: filename, fullPage: true, timeout: 5000, animations: "disabled", mask: [page.locator('input[type="password"], [data-faultlane-private]'), ...config.maskTestIds.map((id) => page.getByTestId(id))] });
}

async function executeScenario(browser: Browser, config: FaultLaneConfig, scenario: Scenario, directory: string): Promise<ScenarioResult> {
  const started = Date.now();
  const result = emptyResult(scenario);
  const controller = new AbortController();
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let completed = 0;
  let routeError = false;
  let blocked = 0;
  let pageErrors = 0;
  let firstRequestAt = 0;
  let timedOut = false;
  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", acceptDownloads: false });
    await context.grantPermissions(["local-network-access"], { origin: config.baseUrl });
    const activeContext = context;
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      void activeContext.close().catch(() => undefined);
    }, config.timeouts.scenarioMs);
    context.setDefaultTimeout(config.timeouts.assertionMs);
    context.setDefaultNavigationTimeout(config.timeouts.navigationMs);
    await context.routeWebSocket("**/*", (socket) => {
      if (isLoopbackUrl(socket.url().replace(/^ws/, "http"))) socket.connectToServer();
      else { blocked++; socket.close(); }
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      if (!isLoopbackUrl(url) || !["GET", "HEAD"].includes(request.method())) {
        blocked++;
        await route.abort("blockedbyclient").catch(() => undefined);
        return;
      }
      const target = request.method() === config.api.method && matchesApi(url, config.api);
      try {
        if (target) {
          result.interceptedRequests++;
          if (!firstRequestAt) firstRequestAt = Date.now();
          await simulate(route, scenario, config.timeouts.requestMs, controller.signal);
          completed++;
        } else await forwardLocal(route, config.timeouts.requestMs);
      } catch {
        if (!controller.signal.aborted) routeError = true;
        await route.abort("failed").catch(() => undefined);
      }
    });
    page = await context.newPage();
    page.on("pageerror", () => pageErrors++);
    page.on("dialog", (dialog) => { void dialog.dismiss().catch(() => undefined); });
    // Interceptors are already installed; the demo fetch begins only after navigation.
    const navigation = await page.goto(new URL(config.pagePath, config.baseUrl).href, { waitUntil: "domcontentloaded" });
    if (!navigation || !navigation.ok()) throw new ExecutionError("The configured page did not return a successful HTTP response.");
    try {
      await expect.poll(() => result.interceptedRequests, { timeout: config.timeouts.requestMs }).toBeGreaterThan(0);
    } catch { throw new ExecutionError("No matching API request was intercepted. Check the pathname, GET method, browser-side fetching and page trigger."); }
    if (scenario.id === "slow") {
      await checkAssertions(page, scenario.duringDelay, config.timeouts.assertionMs, "during-delay", result.assertions, controller.signal);
      const duringDelay = Date.now() - firstRequestAt < scenario.delayMs && completed === 0;
      if (!duringDelay) result.assertions.push({ expected: "Loading assertions succeed before the simulated delay ends", observed: "The delay ended before the loading assertions completed; loading during the delay was not established.", passed: false, phase: "during-delay" });
      if (duringDelay) {
        try { await screenshot(page, path.join(directory, "slow-loading.png"), config); result.loadingScreenshot = "slow-loading.png"; }
        catch { result.diagnostics.push("Loading screenshot could not be captured."); }
      }
    }
    try {
      await expect.poll(() => { if (routeError) throw new ExecutionError("API simulation or local forwarding failed."); return completed; }, { timeout: config.timeouts.requestMs + (scenario.id === "slow" ? scenario.delayMs : 0) }).toBeGreaterThan(0);
    } catch { throw new ExecutionError("API simulation or local forwarding did not complete within the request budget."); }
    if (routeError) throw new ExecutionError("A request could not be forwarded or simulated safely.");
    await checkAssertions(page, scenario.assertions, config.timeouts.assertionMs, "after-response", result.assertions, controller.signal);
    result.status = result.assertions.every((assertion) => assertion.passed) && pageErrors === 0 ? "PASS" : "FAIL";
    result.observation = result.status === "PASS" ? "Target API request intercepted; all configured UI assertions succeeded." : result.assertions.find((assertion) => !assertion.passed)?.observed ?? "An uncaught browser JavaScript error was observed.";
    result.suggestion = result.status === "PASS" ? "Review the evidence and expand assertions for other important UI behaviors." : "Inspect the UI state transition, error handling and test locator for the failed expectation. This is not a proven root cause.";
  } catch (error) {
    result.status = "ERROR";
    result.observation = timedOut ? "Scenario exceeded its total time budget." : error instanceof ExecutionError ? error.message : "Browser setup or navigation failed. Check that Chromium is installed and the local application is reachable.";
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    if (blocked) result.diagnostics.push(`${blocked} external, non-read-only or WebSocket request(s) blocked by local-only policy.`);
    if (pageErrors) result.diagnostics.push(`${pageErrors} uncaught browser JavaScript error(s); raw messages omitted for privacy.`);
    if (page && !page.isClosed()) {
      const name = `${scenario.id}${result.status === "PASS" ? "" : "-failure"}.png`;
      try { await screenshot(page, path.join(directory, name), config); result.screenshot = name; }
      catch { result.diagnostics.push("Scenario screenshot could not be captured."); if (result.status === "PASS") { result.status = "ERROR"; result.observation = "UI assertions passed, but required screenshot evidence could not be saved."; } }
    }
    await context?.close().catch(() => undefined);
    result.durationMs = Date.now() - started;
  }
  return result;
}

export async function runFaultLane(input: FaultLaneConfig, options: { only?: string; onResult?: (result: ScenarioResult) => void } = {}): Promise<{ run: RunResult; directory: string }> {
  const config = configSchema.parse(input);
  const scenarios = selectScenarios(config, options.only);
  const started = new Date();
  const id = `${started.toISOString().replace(/[-:.]/g, "")}-${randomUUID().slice(0, 8)}`;
  const directory = path.resolve(config.reportsDir, id);
  await mkdir(directory, { recursive: true });
  const target = new URL(config.pagePath, config.baseUrl);
  const run: RunResult = { schemaVersion: 1, id, startedAt: started.toISOString(), durationMs: 0, application: `${target.origin}${target.pathname}`, apiPattern: config.api.pathname, results: [] };
  let browser: Browser | undefined;
  try { browser = await chromium.launch({ headless: true, timeout: 20_000 }); }
  catch {
    run.results = scenarios.map((scenario) => ({ ...emptyResult(scenario), observation: "Chromium could not be launched. Run npm run browsers:install and check the local environment." }));
  }
  if (browser) {
    try {
      for (const scenario of scenarios) {
        const result = await executeScenario(browser, config, scenario, directory);
        run.results.push(result);
        options.onResult?.(result);
      }
    } finally { await browser.close(); }
  }
  run.durationMs = Date.now() - started.getTime();
  await writeReport(directory, run);
  return { run, directory };
}
