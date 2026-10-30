import { expect, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import type { Action, Assertion, FaultLaneConfig, Scenario } from "./config";
import { networkPolicySchema, type SequenceResponse } from "./endpoint-schema";
import { classifyNetworkRequest, matchesEndpoint } from "./network-policy";
import { NetworkTracker } from "./network-tracker";
import { safeRequestMetadata } from "./network-redaction";
import type { AssertionResult, NetworkEvent, NetworkSummary, ScenarioResult } from "./results";
import { RunnerIssue } from "./errors";
import { forwardLocal, scenarioLabels } from "./scenarios";
import { describeAction, executeAction, navigateLocal } from "./actions";
import { checkAssertions, describeAssertion } from "./assertions";
import { captureEvidence, evidenceFailed, evidenceSaved, executeSteps, type PlannedStep } from "./steps";
import { EvidenceIssue, evidenceReason } from "./evidence";

export function emptyNetworkSummary(): NetworkSummary {
  return {
    policy: "explicit-origins", observedRequests: 0, blockedRequests: 0, allowedRequests: 0, mockedRequests: 0,
    events: [], truncated: false, zeroMatchTargets: [],
    warnings: [
      "Service workers are blocked and HTTP cache is disabled by routing; offline/cache behavior is not tested.",
      "Coverage includes browser fetch/XHR only. Server-side requests, Supabase Auth/Realtime/Storage and WebSocket messages are not injected.",
      "API allowlists permit mocking, not remote forwarding. Query values, headers and bodies are omitted; screenshots may contain application data.",
    ], hypotheses: [], nextActions: [],
  };
}

export function emptyNetworkResult(config: FaultLaneConfig, scenario: Scenario): ScenarioResult {
  const tracker = new NetworkTracker(config.endpoints!, config.baseUrl, scenario.id === "baseline" ? [] : scenario.targets ?? [], scenario.id === "baseline" ? "baseline" : "fault");
  const network = emptyNetworkSummary();
  network.zeroMatchTargets = config.endpoints!.map((endpoint) => endpoint.id);
  return {
    id: scenario.id, name: scenario.name ?? scenarioLabels[scenario.id], status: "ERROR", code: null, durationMs: 0,
    observedRequests: 0, interceptedRequests: 0, faultedRequests: 0, requests: [], steps: [], failedStep: null, assertions: [],
    observation: "Scenario did not finish.", suggestion: "Check the local application, configured endpoints and browser installation.",
    screenshot: null, loadingScreenshot: null, diagnostics: [], evidence: { status: "SKIPPED", failures: [] }, endpoints: tracker.summary(), network,
  };
}

const isFault = (response: SequenceResponse): boolean => !["mock", "forward"].includes(response.type);

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "vary": "Origin",
    "access-control-expose-headers": "Content-Range, Range-Unit, Retry-After",
    "cache-control": "no-store", "content-type": "application/json; charset=utf-8",
  };
}

async function respond(route: Route, response: SequenceResponse, origin: string, format: string, timeout: number, signal: AbortSignal): Promise<{ status: number | null; outcome: "mocked" | "simulated" | "forwarded" | "aborted" }> {
  if (response.type === "forward") return { status: await forwardLocal(route, timeout), outcome: "forwarded" };
  if (response.type === "network") { await route.abort("failed"); return { status: null, outcome: "aborted" }; }
  if (response.type === "slow") {
    await delay(response.delayMs, undefined, { signal });
    const completed = await respond(route, response.response, origin, format, timeout, signal);
    return { ...completed, outcome: completed.outcome === "forwarded" ? "forwarded" : "simulated" };
  }
  const headers = corsHeaders(origin);
  let status = 200;
  let json: unknown = [];
  if (response.type === "mock") { status = response.status; json = response.json; }
  else if (response.type === "http-500" || response.type === "http-429") {
    status = response.type === "http-500" ? 500 : 429;
    const message = status === 500 ? "Simulated server error" : "Simulated rate limit";
    json = format === "supabase-rest" ? { code: `FL${status}`, message, details: null, hint: null } : { error: message };
    if (response.type === "http-429") headers["retry-after"] = String(response.retryAfterSeconds);
  }
  if (format === "supabase-rest" && Array.isArray(json)) {
    headers["range-unit"] = "items";
    headers["content-range"] = json.length ? `0-${json.length - 1}/${json.length}` : "*/0";
  }
  await route.fulfill({ status, headers, body: JSON.stringify(json) });
  return { status, outcome: response.type === "mock" ? "mocked" : "simulated" };
}

// Asset permission never forwards browser cookies, authorization or request bodies.
// An independent credential-free HTTP request also avoids the context cookie jar.
async function forwardAsset(route: Route, timeout: number): Promise<void> {
  const response = await fetch(route.request().url(), { method: "GET", redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(timeout), headers: { accept: "*/*" } });
  const reader = response.body?.getReader();
  try {
    if (response.status >= 300 && response.status < 400) throw new Error("Asset redirect blocked");
    const chunks: Uint8Array[] = []; let size = 0;
    if (reader) while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 8_000_000) throw new Error("Asset size limit");
      chunks.push(part.value);
    }
    const headers: Record<string, string> = {};
    for (const name of ["content-type", "access-control-allow-origin", "cross-origin-resource-policy"]) {
      const value = response.headers.get(name); if (value) headers[name] = value;
    }
    await route.fulfill({ status: response.status, headers, body: Buffer.concat(chunks) });
  } finally { await reader?.cancel().catch(() => undefined); }
}

export async function executeNetworkScenario(browser: Browser, config: FaultLaneConfig, scenario: Scenario, directory: string): Promise<ScenarioResult> {
  const started = Date.now();
  const result = emptyNetworkResult(config, scenario);
  const network = result.network!;
  const policy = networkPolicySchema.parse(config.network ?? {});
  const origin = new URL(config.baseUrl).origin;
  const tracker = new NetworkTracker(config.endpoints!, config.baseUrl, scenario.id === "baseline" ? [] : scenario.targets ?? [], scenario.id === "baseline" ? "baseline" : "fault");
  const actions = scenario.actions ?? config.actions ?? [];
  const recovery = scenario.id === "baseline" ? undefined : scenario.sequenceRecovery;
  const watched = new Map<string, { request: Extract<Action, { type: "waitForRequest" }>["request"]; count: number }>();
  for (const action of [...actions, ...(recovery?.actions ?? [])]) if (action.type === "waitForRequest") watched.set(JSON.stringify(action.request), { request: action.request, count: 0 });
  const controller = new AbortController();
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false; let pageErrors = 0;
  let routeIssue: RunnerIssue | undefined;
  const events = new WeakMap<object, NetworkEvent>();
  const eventFor = (request: { url(): string; method(): string; resourceType(): string }): NetworkEvent => {
    const existing = events.get(request); if (existing) return existing;
    const event: NetworkEvent = { ...safeRequestMetadata(request.url(), request.method(), request.resourceType()), decision: "observed" };
    events.set(request, event); network.observedRequests++;
    if (network.events.length < 200) network.events.push(event); else network.truncated = true;
    return event;
  };
  const checkHealth = () => {
    if (timedOut) throw new RunnerIssue("ERROR", "SCENARIO_TIMEOUT", "Scenario exceeded its total time budget; remaining steps were skipped.");
    tracker.check();
    if (routeIssue) throw routeIssue;
    if (pageErrors) throw new RunnerIssue("FAIL", "PAGE_JAVASCRIPT_ERROR", "An uncaught browser JavaScript error was observed; raw message omitted.");
    if (page?.isClosed()) throw new RunnerIssue("ERROR", "BROWSER_CLOSED", "The browser page closed before execution finished.");
  };
  const waitFor = async (id: string, count: number, recovering = false) => {
    const state = tracker.states.get(id)!;
    // Kolejne requesty mogą zaczynać się dopiero po zakończeniu poprzedniego.
    // Budżet obejmuje wszystkie zadeklarowane opóźnienia wymaganej części sekwencji.
    const extra = state.sequence.slice(0, count).reduce((sum, response) => sum + (response.type === "slow" ? response.delayMs : 0), 0);
    try {
      await expect.poll(() => { checkHealth(); return state.records.slice(0, count).filter((r) => r.outcome !== "pending").length; }, { timeout: config.timeouts.requestMs + extra }).toBeGreaterThanOrEqual(count);
    } catch {
      checkHealth();
      if (!state.interceptedRequests) throw new RunnerIssue("ERROR", "API_NOT_OBSERVED", `No matching API request was intercepted for endpoint ${id}. See observed routes, zero matches and diagnostic hypotheses.`);
      if (state.interceptedRequests < count) throw new RunnerIssue("FAIL", recovering ? "RECOVERY_REQUEST_MISSING" : "RESPONSE_SEQUENCE_INCOMPLETE", `Endpoint ${id} produced ${state.interceptedRequests} of ${count} required requests; UI alone cannot establish recovery.`);
      throw new RunnerIssue("ERROR", "API_REQUEST_TIMEOUT", `Endpoint ${id} did not finish within the bounded request timeout.`);
    }
  };
  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", acceptDownloads: false });
    await context.grantPermissions(["local-network-access"], { origin });
    const activeContext = context;
    timer = setTimeout(() => { timedOut = true; controller.abort(); void activeContext.close().catch(() => undefined); }, config.timeouts.scenarioMs);
    context.setDefaultTimeout(config.timeouts.assertionMs); context.setDefaultNavigationTimeout(config.timeouts.navigationMs);
    context.on("request", (request) => {
      eventFor(request);
      if (!["fetch", "xhr"].includes(request.resourceType())) return;
      tracker.observe(request.url(), request.method());
      for (const watch of watched.values()) if (matchesEndpoint(request.url(), request.method(), watch.request, config.baseUrl)) watch.count = Math.min(31, watch.count + 1);
    });
    await context.routeWebSocket("**/*", (socket) => {
      if (new URL(socket.url().replace(/^ws/, "http")).origin === origin) socket.connectToServer();
      else {
        network.blockedRequests++;
        if (network.events.length < 200) network.events.push({ ...safeRequestMetadata(socket.url().replace(/^ws/, "http"), "GET", "websocket"), decision: "blocked" });
        else network.truncated = true;
        socket.close();
      }
    });
    await context.route("**/*", async (route) => {
      const request = route.request(); const event = eventFor(request);
      const block = async () => { event.decision = "blocked"; network.blockedRequests++; await route.abort("blockedbyclient").catch(() => undefined); };
      try {
        // A preflight is synthetic permission only, never endpoint request coverage.
        if (request.method() === "OPTIONS") {
          const method = request.headers()["access-control-request-method"];
          const target = method ? tracker.match(request.url(), method) : undefined;
          if (!target || request.headers().origin !== origin) { await block(); return; }
          event.decision = "preflight"; event.endpointId = target.id;
          await route.fulfill({ status: 204, headers: { ...corsHeaders(origin), "access-control-allow-methods": method!, "access-control-allow-headers": "authorization, apikey, content-type, prefer, x-client-info, accept-profile, content-profile, range, range-unit", "access-control-max-age": "0" } });
          return;
        }
        const endpoint = ["fetch", "xhr"].includes(request.resourceType()) ? tracker.match(request.url(), request.method()) : undefined;
        if (endpoint) {
          event.endpointId = endpoint.id;
          const pending = tracker.begin(endpoint.id);
          if (!pending) { await block(); return; }
          try {
            const completed = await respond(route, pending.response, origin, endpoint.format, config.timeouts.requestMs, controller.signal);
            tracker.complete(endpoint.id, pending.record, completed.outcome, completed.status);
            event.decision = completed.outcome === "forwarded" ? "forwarded" : "mocked";
            if (completed.outcome === "forwarded") network.allowedRequests++; else network.mockedRequests++;
          } catch {
            tracker.complete(endpoint.id, pending.record, "error", null);
            throw new Error("Endpoint response failed");
          }
          return;
        }
        const permission = classifyNetworkRequest(request.url(), request.method(), request.resourceType(), config.baseUrl, policy);
        if (permission.kind === "blocked") { await block(); return; }
        if (permission.kind === "allowed-asset") { await forwardAsset(route, config.timeouts.requestMs); event.decision = "allowed-asset"; }
        else { await forwardLocal(route, config.timeouts.requestMs); event.decision = "forwarded"; }
        network.allowedRequests++;
      } catch {
        if (!controller.signal.aborted) routeIssue ??= new RunnerIssue("ERROR", "ROUTE_EXECUTION", "A configured response or permitted local/asset request could not complete safely. Redirects are blocked; check local availability and timeouts.");
        await route.abort("failed").catch(() => undefined);
      }
    });
    page = await context.newPage(); const activePage = page;
    page.on("pageerror", () => pageErrors++); page.on("dialog", (dialog) => { void dialog.dismiss().catch(() => undefined); });
    const plan: PlannedStep[] = [{ phase: "setup", expected: `Open ${new URL(config.pagePath, config.baseUrl).pathname}`, run: () => navigateLocal(activePage, config, config.pagePath) }];
    const addActions = (items: Action[], phase: "action" | "recovery") => {
      for (const action of items) plan.push({ phase, expected: describeAction(action), run: () => executeAction(action, activePage, config, result, controller.signal, (a) => watched.get(JSON.stringify(a.request))?.count ?? 0, checkHealth) });
    };
    const addAssertions = (items: Assertion[], phase: AssertionResult["phase"], stepPhase: "fault" | "recovery") => {
      for (const assertion of items) plan.push({ phase: stepPhase, expected: describeAssertion(assertion), run: async () => {
        await checkAssertions(activePage, [assertion], config.timeouts.assertionMs, phase, result.assertions, controller.signal);
        const checked = result.assertions.at(-1)!;
        if (!checked.passed) throw new RunnerIssue("FAIL", "ASSERTION_FAILED", checked.observed);
        if (phase === "during-delay") {
          const pending = [...tracker.states.values()].some((state) => state.records.some((record) => {
            const response = state.sequence[record.ordinal - 1];
            const began = state.startedAt.get(record.ordinal);
            return record.outcome === "pending" && response?.type === "slow" && began !== undefined && Date.now() - began < response.delayMs;
          }));
          if (!pending) throw new RunnerIssue("FAIL", "LOADING_NOT_OBSERVED_DURING_DELAY", "Loading was not verified while a configured delayed response was pending.");
        }
      } });
    };
    addActions(actions, "action");
    if (scenario.id === "slow") {
      plan.push({ phase: "fault", expected: "Observe a configured delayed API request", run: async () => {
        try { await expect.poll(() => { checkHealth(); return [...tracker.states.values()].some((s) => s.records.some((r) => s.sequence[r.ordinal - 1]?.type === "slow")); }, { timeout: config.timeouts.requestMs }).toBe(true); }
        catch { checkHealth(); throw new RunnerIssue("ERROR", "API_NOT_OBSERVED", "No configured delayed browser request was intercepted."); }
      } });
      addAssertions(scenario.duringDelay, "during-delay", "fault");
      plan.push({ phase: "fault", expected: "Capture the loading state during the simulated delay", run: async () => { try { await captureEvidence(activePage, path.join(directory, "slow-loading.png"), config); evidenceSaved(result); result.loadingScreenshot = "slow-loading.png"; } catch (error) { evidenceFailed(result, "loading", error); throw new RunnerIssue("ERROR", "EVIDENCE_WRITE", `Loading screenshot failed: ${evidenceReason(error)}.`); } } });
    }
    plan.push({ phase: "fault", expected: "Complete required per-endpoint requests and fault responses", run: async () => {
      await Promise.all([...tracker.states.entries()].map(([id, state]) => {
        const count = recovery ? Math.max(1, state.sequence.reduce((last, item, i) => isFault(item) ? i + 1 : last, 0)) : state.expectedRequests;
        return waitFor(id, count);
      }));
    } });
    addAssertions(scenario.assertions, "after-response", "fault");
    if (recovery) {
      plan.push({ phase: "recovery", expected: "Start the declared recovery journey after fault coverage", run: async () => { tracker.armRecovery(); } });
      addActions(recovery.actions, "recovery");
      plan.push({ phase: "recovery", expected: "Observe all real browser requests required by the recovery sequence", run: async () => { await Promise.all([...tracker.states.entries()].map(([id, state]) => waitFor(id, state.expectedRequests, true))); } });
      addAssertions(recovery.assertions, "recovery", "recovery");
    }
    plan.push({ phase: "fault", expected: "Verify exact endpoint coverage, response sequences and network policy", run: async () => {
      tracker.validateCoverage();
      if (network.blockedRequests) throw new RunnerIssue("ERROR", "NETWORK_POLICY_BLOCKED", "Unconfigured network requests were blocked. Inspect safe request metadata and explicitly configure only necessary endpoints or assets.");
    } });
    await executeSteps(plan, activePage, config, result, directory, checkHealth);
    checkHealth(); result.status = "PASS";
    result.observation = "Every required endpoint request and configured response sequence completed; all explicit UI expectations passed.";
    result.suggestion = "Review endpoint evidence. Mocked recovery proves the browser flow, not the availability or correctness of a remote service.";
  } catch (error) {
    let issue = timedOut ? new RunnerIssue("ERROR", "SCENARIO_TIMEOUT", "Scenario exceeded its total time budget.") : error instanceof RunnerIssue ? error : new RunnerIssue("ERROR", "BROWSER_EXECUTION", "Browser setup or execution could not be completed safely.");
    if (issue.status === "FAIL" && network.blockedRequests > 0 && !tracker.issue) issue = new RunnerIssue("ERROR", "NETWORK_POLICY_BLOCKED", "A UI expectation could not be established while unconfigured dependencies were blocked. Inspect network permissions before classifying application behavior.");
    result.status = issue.status; result.code = issue.code; result.observation = issue.message;
    result.suggestion = issue.status === "FAIL" ? "Inspect the failed UI expectation and actual endpoint sequence; this is evidence, not a proven root cause." : "Compare configured routes with observed browser requests and blocked dependencies. Unexecuted assertions remain unverified.";
  } finally {
    if (timer) clearTimeout(timer);
    if (page && !page.isClosed()) {
      const filename = `${scenario.id}${result.status === "PASS" ? "" : "-failure"}.png`;
      try { await captureEvidence(page, path.join(directory, filename), config); result.screenshot = filename; evidenceSaved(result); }
      catch (error) { evidenceFailed(result, "scenario", error); if (result.diagnostics.length < 10) result.diagnostics.push(`Scenario screenshot failed: ${evidenceReason(error)}.`); if (result.status === "PASS") { result.status = "ERROR"; result.code = "EVIDENCE_WRITE"; result.observation = "Required screenshot evidence could not be saved."; } }
    } else if (page) evidenceFailed(result, "scenario", new EvidenceIssue("capture", "PAGE_CLOSED"));
    controller.abort(); await context?.close().catch(() => undefined);
    if (result.status === "PASS") {
      try {
        tracker.validateCoverage();
        if (routeIssue) throw routeIssue;
        if (network.blockedRequests) throw new RunnerIssue("ERROR", "NETWORK_POLICY_BLOCKED", "A late unconfigured request was blocked while saving evidence.");
        if (pageErrors) throw new RunnerIssue("FAIL", "PAGE_JAVASCRIPT_ERROR", "A late browser JavaScript error occurred; raw message omitted.");
      } catch (error) {
        const issue = error instanceof RunnerIssue ? error : new RunnerIssue("ERROR", "BROWSER_EXECUTION", "Final coverage could not be verified.");
        result.status = issue.status; result.code = issue.code; result.observation = issue.message;
        const last = result.steps?.at(-1);
        if (last) { last.status = issue.status; last.code = issue.code; last.observed = issue.message; result.failedStep = last.index; }
      }
    }
    result.endpoints = tracker.summary();
    result.observedRequests = result.endpoints.reduce((sum, e) => sum + e.observedRequests, 0);
    result.interceptedRequests = result.endpoints.reduce((sum, e) => sum + e.interceptedRequests, 0);
    result.faultedRequests = result.endpoints.reduce((sum, e) => sum + e.faultedRequests, 0);
    network.zeroMatchTargets = result.endpoints.filter((e) => e.interceptedRequests === 0).map((e) => e.id);
    if (network.zeroMatchTargets.length) {
      network.hypotheses.push("Possible causes: incorrect origin, path, method or query; missing user trigger; server-side fetch; unsupported transport. These are hypotheses, not detected root causes.");
      network.nextActions.push("Compare configured routes to observed fetch/XHR metadata. Confirm the local port and action, then inspect the application's browser Network panel.", "Check whether fetching runs in a Next.js Server Component/route handler. FaultLane does not intercept that server process.");
    }
    if (network.blockedRequests) network.nextActions.push("Inspect blocked destinations. Add a narrow mock endpoint or asset permission only when the dependency is intentional; API mock permission never enables remote forwarding.");
    if (pageErrors) result.diagnostics.push(`${pageErrors} uncaught browser JavaScript error(s); raw messages omitted.`);
    result.durationMs = Date.now() - started;
  }
  return result;
}
