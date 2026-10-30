import { expect, type Page } from "@playwright/test";
import type { Action, FaultLaneConfig } from "./config";
import { isLoopbackUrl } from "./config";
import { checkAssertions, describeAssertion } from "./assertions";
import { describeLocator, locate } from "./locators";
import { RunnerIssue } from "./errors";
import type { ScenarioResult } from "./results";

export function describeAction(action: Action): string {
  switch (action.type) {
    case "navigate": return `Navigate to ${action.path.split(/[?#]/)[0]}`;
    case "click": return `Click ${describeLocator(action.locator)}`;
    case "fill": return `Fill ${describeLocator(action.locator)} (value omitted)`;
    case "waitForElement": return `Wait for ${describeLocator(action.locator)} to be ${action.state}`;
    case "waitForRequest": return `Observe ${action.request.method} ${action.request.pathname}, occurrence ${action.occurrence}`;
    case "assert": return describeAssertion(action.assertion);
  }
}

export async function navigateLocal(page: Page, config: FaultLaneConfig, pagePath: string, timeout = config.timeouts.navigationMs) {
  const url = new URL(pagePath, config.baseUrl);
  if (!isLoopbackUrl(url.href) || url.origin !== new URL(config.baseUrl).origin) throw new RunnerIssue("ERROR", "UNSAFE_TARGET", "Navigation must remain on the configured loopback origin.");
  try {
    const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout });
    if (!response?.ok()) throw new Error("Unsuccessful navigation");
  } catch { throw new RunnerIssue("ERROR", "NAVIGATION_FAILED", "The configured local page could not be loaded successfully. Check the server, final URL and navigation timeout."); }
}

export async function executeAction(action: Action, page: Page, config: FaultLaneConfig, result: ScenarioResult, signal: AbortSignal, requestCount: (action: Extract<Action, { type: "waitForRequest" }>) => number, checkHealth: () => void) {
  signal.throwIfAborted();
  const timeout = action.timeoutMs ?? config.timeouts.assertionMs;
  if (action.type === "navigate") return navigateLocal(page, config, action.path, action.timeoutMs ?? config.timeouts.navigationMs);
  if (action.type === "waitForRequest") {
    try { await expect.poll(() => { checkHealth(); return requestCount(action); }, { timeout: action.timeoutMs ?? config.timeouts.requestMs }).toBeGreaterThanOrEqual(action.occurrence); }
    catch {
      checkHealth();
      throw new RunnerIssue("ERROR", "API_NOT_OBSERVED", `${describeAction(action)} did not occur within the request timeout. Check coverage, pathname and trigger.`);
    }
    return;
  }
  if (action.type === "assert") {
    await checkAssertions(page, [action.assertion], timeout, "action", result.assertions, signal);
    const assertion = result.assertions.at(-1)!;
    if (!assertion.passed) throw new RunnerIssue("FAIL", "ASSERTION_FAILED", assertion.observed);
    return;
  }
  try {
    const locator = locate(page, action.locator);
    if (action.type === "click") await locator.click({ timeout });
    else if (action.type === "fill") await locator.fill(action.value, { timeout });
    else if (action.state === "visible") await expect(locator).toBeVisible({ timeout });
    else await expect(locator).toBeHidden({ timeout });
  } catch {
    checkHealth();
    if (page.isClosed()) throw new RunnerIssue("ERROR", "BROWSER_CLOSED", "The browser page closed during a user action.");
    throw new RunnerIssue("FAIL", "ACTION_EXPECTATION_FAILED", `${describeAction(action)} did not succeed within ${timeout} ms. The element may be missing, ambiguous, hidden, disabled or not editable.`);
  }
}
