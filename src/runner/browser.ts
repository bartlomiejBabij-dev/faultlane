import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { checkAssertions, describeAssertion } from "./assertions";
import { configSchema, isLoopbackUrl, selectScenarios, type Assertion, type FaultLaneConfig, type Scenario } from "./config";
import { forwardLocal, scenarioLabels, simulate } from "./scenarios";
import { type AssertionResult, type RunResult, type ScenarioResult } from "./results";
import { writeReport } from "./report";
import { RunnerIssue } from "./errors";
import { describeAction, executeAction, navigateLocal } from "./actions";
import { captureEvidence, executeSteps, type PlannedStep } from "./steps";
import { RequestTracker } from "./requests";

function emptyResult(scenario: Scenario): ScenarioResult {
  return { id: scenario.id, name: scenario.name ?? scenarioLabels[scenario.id], status: "ERROR", code: null, durationMs: 0, observedRequests: 0, interceptedRequests: 0, faultedRequests: 0, requests: [], steps: [], failedStep: null, assertions: [], observation: "Scenario did not finish.", suggestion: "Inspect the local server, API pathname and configured timeouts.", screenshot: null, loadingScreenshot: null, diagnostics: [] };
}

async function executeScenario(browser: Browser, config: FaultLaneConfig, scenario: Scenario, directory: string): Promise<ScenarioResult> {
  const started = Date.now();
  const result = emptyResult(scenario);
  const controller = new AbortController();
  const actions = scenario.actions ?? config.actions ?? [];
  const recovery = scenario.id !== "baseline" ? scenario.recovery : undefined;
  const tracker = new RequestTracker(config, scenario, [...actions, ...(recovery?.actions ?? [])]);
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let routeIssue: RunnerIssue | undefined;
  let blocked = 0;
  let pageErrors = 0;
  let timedOut = false;
  const checkHealth = () => {
    if (timedOut) throw new RunnerIssue("ERROR", "SCENARIO_TIMEOUT", "Scenario exceeded its total time budget; remaining steps were skipped.");
    tracker.check();
    if (routeIssue) throw routeIssue;
    if (pageErrors) throw new RunnerIssue("FAIL", "PAGE_JAVASCRIPT_ERROR", "An uncaught browser JavaScript error was observed; raw message omitted.");
    if (page?.isClosed()) throw new RunnerIssue("ERROR", "BROWSER_CLOSED", "The browser page closed before execution finished.");
  };
  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", acceptDownloads: false });
    await context.grantPermissions(["local-network-access"], { origin: config.baseUrl });
    const activeContext = context;
    timer = setTimeout(() => { timedOut = true; controller.abort(); void activeContext.close().catch(() => undefined); }, config.timeouts.scenarioMs);
    context.setDefaultTimeout(config.timeouts.assertionMs);
    context.setDefaultNavigationTimeout(config.timeouts.navigationMs);
    context.on("request", (request) => tracker.observe(request.url(), request.method()));
    await context.routeWebSocket("**/*", (socket) => {
      if (isLoopbackUrl(socket.url().replace(/^ws/, "http"))) socket.connectToServer();
      else { blocked++; socket.close(); }
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (!isLoopbackUrl(request.url()) || !["GET", "HEAD"].includes(request.method())) {
        blocked++;
        await route.abort("blockedbyclient").catch(() => undefined);
        return;
      }
      const record = tracker.matches(request.url(), request.method()) ? tracker.begin() : undefined;
      try {
        if (!record) { await forwardLocal(route, config.timeouts.requestMs); return; }
        if (tracker.issue) { record.outcome = "blocked"; await route.abort("blockedbyclient"); return; }
        const fault = scenario.id !== "baseline" && record.ordinal <= tracker.affected;
        record.status = fault ? await simulate(route, scenario, config.timeouts.requestMs, controller.signal) : await forwardLocal(route, config.timeouts.requestMs);
        record.outcome = fault ? scenario.id === "network" ? "aborted" : "simulated" : "forwarded";
        if (fault) tracker.faulted++;
      } catch {
        if (record) record.outcome = "error";
        if (!controller.signal.aborted) routeIssue ??= new RunnerIssue("ERROR", "ROUTE_EXECUTION", "A request could not be forwarded or simulated safely. Check local connectivity, redirects and request timeout.");
        await route.abort("failed").catch(() => undefined);
      }
    });
    page = await context.newPage();
    const activePage = page;
    page.on("pageerror", () => pageErrors++);
    page.on("dialog", (dialog) => { void dialog.dismiss().catch(() => undefined); });
    const plan: PlannedStep[] = [{ phase: "setup", expected: `Open ${new URL(config.pagePath, config.baseUrl).pathname}`, run: () => navigateLocal(activePage, config, config.pagePath) }];
    let loadingVerifiedDuringDelay = false;
    const addAssertions = (assertions: Assertion[], phase: AssertionResult["phase"], stepPhase: PlannedStep["phase"]) => {
      for (const assertion of assertions) plan.push({ phase: stepPhase, expected: describeAssertion(assertion), run: async () => {
        await checkAssertions(activePage, [assertion], config.timeouts.assertionMs, phase, result.assertions, controller.signal);
        const checked = result.assertions.at(-1)!;
        if (!checked.passed) throw new RunnerIssue("FAIL", "ASSERTION_FAILED", checked.observed);
        if (phase === "during-delay" && scenario.id === "slow") {
          loadingVerifiedDuringDelay = Date.now() - tracker.firstAt < scenario.delayMs && tracker.records[0]?.outcome === "pending";
          if (!loadingVerifiedDuringDelay) throw new RunnerIssue("FAIL", "LOADING_NOT_OBSERVED_DURING_DELAY", "Loading was not verified until after the configured delay ended.");
        }
      } });
    };
    for (const action of actions) plan.push({ phase: "action", expected: describeAction(action), run: () => executeAction(action, activePage, config, result, controller.signal, (a) => tracker.count(a), checkHealth) });
    plan.push({ phase: "fault", expected: "Observe and intercept the configured API request", run: async () => {
      try { await expect.poll(() => { checkHealth(); return tracker.intercepted; }, { timeout: config.timeouts.requestMs }).toBeGreaterThan(0); }
      catch { checkHealth(); throw new RunnerIssue("ERROR", "API_NOT_OBSERVED", "No matching API request was intercepted. Check the pathname, GET method, browser-side fetching and page trigger."); }
    } });
    if (scenario.id === "slow") {
      addAssertions(scenario.duringDelay, "during-delay", "fault");
      plan.push({ phase: "fault", expected: "Loading assertions complete during the simulated delay", run: async () => {
        if (!loadingVerifiedDuringDelay) throw new RunnerIssue("FAIL", "LOADING_NOT_OBSERVED_DURING_DELAY", "The delay ended before the loading assertions completed; loading during the delay was not established.");
        await captureEvidence(activePage, path.join(directory, "slow-loading.png"), config);
        result.loadingScreenshot = "slow-loading.png";
      } });
    }
    plan.push({ phase: "fault", expected: "Complete the required API response simulation or baseline forwarding", run: async () => {
      const count = scenario.id === "baseline" ? 1 : scenario.affectRequests ?? 1;
      for (let ordinal = 1; ordinal <= count; ordinal++) await tracker.wait(ordinal, config.timeouts.requestMs + (scenario.id === "slow" ? scenario.delayMs : 0), false, checkHealth);
    } });
    addAssertions(scenario.assertions, "after-response", "fault");
    if (recovery) {
      for (const [i, action] of recovery.actions.entries()) plan.push({ phase: "recovery", expected: describeAction(action), run: async () => {
        if (i === 0) tracker.armRecovery();
        await executeAction(action, activePage, config, result, controller.signal, (a) => tracker.count(a), checkHealth);
        if (i === 0) await tracker.wait(tracker.affected + 1, config.timeouts.requestMs, true, checkHealth);
      } });
      plan.push({ phase: "recovery", expected: "Retry caused exactly one additional API request with a real successful response", run: async () => {
        await tracker.wait(tracker.affected + 1, config.timeouts.requestMs, true, checkHealth);
        if (tracker.intercepted !== tracker.affected + 1 || tracker.observed !== tracker.intercepted) throw new RunnerIssue("FAIL", "RECOVERY_REQUEST_COUNT", "Observed and intercepted request counts did not establish one new request after Retry.");
      } });
      addAssertions(recovery.assertions, "recovery", "recovery");
    }
    await executeSteps(plan, activePage, config, result, directory, checkHealth);
    checkHealth();
    result.status = "PASS";
    result.observation = recovery ? "Fault requests were simulated; Retry caused one new successful API request; all error and recovery expectations were verified." : "Target API request intercepted; all configured actions and UI assertions succeeded.";
    result.suggestion = "Review the evidence and expand expectations for other important UI behaviors.";
  } catch (error) {
    const issue = timedOut ? new RunnerIssue("ERROR", "SCENARIO_TIMEOUT", "Scenario exceeded its total time budget.") : error instanceof RunnerIssue ? error : new RunnerIssue("ERROR", "BROWSER_EXECUTION", "Browser setup or execution failed. Check Chromium installation and local server availability.");
    result.status = issue.status; result.code = issue.code; result.observation = issue.message;
    result.suggestion = issue.status === "FAIL" ? "Inspect the failed step, UI transition and retry handler. This is an investigation lead, not a proven root cause." : "Check configuration, request coverage, local server, redirects and time budgets. Unexecuted expectations are not verified.";
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    if (blocked) result.diagnostics.push(`${blocked} external, non-read-only or WebSocket request(s) blocked by local-only policy.`);
    if (pageErrors) result.diagnostics.push(`${pageErrors} uncaught browser JavaScript error(s); raw messages omitted for privacy.`);
    if (page && !page.isClosed()) {
      const name = `${scenario.id}${result.status === "PASS" ? "" : "-failure"}.png`;
      try { await captureEvidence(page, path.join(directory, name), config); result.screenshot = name; }
      catch { result.diagnostics.push("Scenario screenshot could not be captured."); if (result.status === "PASS") { result.status = "ERROR"; result.code = "EVIDENCE_WRITE"; result.observation = "UI assertions passed, but required screenshot evidence could not be saved."; } }
    }
    await context?.close().catch(() => undefined);
    // Account for requests that arrived while the final screenshot was being saved.
    const lateIssue = tracker.issue ?? routeIssue;
    if (result.status === "PASS" && lateIssue) {
      result.status = lateIssue.status; result.code = lateIssue.code; result.observation = lateIssue.message;
      const lastStep = result.steps?.at(-1);
      if (lastStep) { lastStep.status = lateIssue.status; lastStep.code = lateIssue.code; lastStep.observed = lateIssue.message; result.failedStep = lastStep.index; }
    }
    result.observedRequests = tracker.observed;
    result.interceptedRequests = tracker.intercepted;
    result.faultedRequests = tracker.faulted;
    result.requests = tracker.records;
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
  const run: RunResult = { schemaVersion: 2, name: config.name ?? "FaultLane local run", id, startedAt: started.toISOString(), durationMs: 0, application: `${target.origin}${target.pathname}`, apiPattern: config.api.pathname, results: [] };
  let browser: Browser | undefined;
  try { browser = await chromium.launch({ headless: true, timeout: 20_000 }); }
  catch { run.results = scenarios.map((scenario) => ({ ...emptyResult(scenario), code: "BROWSER_LAUNCH", observation: "Chromium could not be launched. Run npm run browsers:install and check the local environment." })); }
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
