import { expect, type Page } from "@playwright/test";
import type { Assertion } from "./config";
import type { AssertionResult } from "./results";
import { assertionLocator, describeLocator, locate } from "./locators";

export function describeAssertion(assertion: Assertion) {
  const target = describeLocator(assertionLocator(assertion));
  switch (assertion.state) {
    case "visible": return `${target} is visible`;
    case "hidden": return `${target} is hidden or absent`;
    case "text": return `${target} is visible and contains “${assertion.text}”`;
    case "textAbsent": return `${target} no longer contains “${assertion.text}”`;
    case "count": return `${target} has ${assertion.count} matching element(s)`;
  }
}

export async function checkAssertions(page: Page, assertions: Assertion[], timeout: number, phase: AssertionResult["phase"], results: AssertionResult[], signal?: AbortSignal) {
  for (const assertion of assertions) {
    signal?.throwIfAborted();
    const expected = describeAssertion(assertion);
    const locator = locate(page, assertionLocator(assertion));
    try {
      switch (assertion.state) {
        case "visible": await expect(locator).toBeVisible({ timeout }); break;
        case "hidden": await expect(locator).toBeHidden({ timeout }); break;
        case "text": await expect(locator).toBeVisible({ timeout }); await expect(locator).toContainText(assertion.text, { timeout }); break;
        case "textAbsent": await expect(locator.filter({ hasText: assertion.text })).toHaveCount(0, { timeout }); break;
        case "count": await expect(locator).toHaveCount(assertion.count, { timeout }); break;
      }
      results.push({ expected, observed: `Verified: ${expected}.`, passed: true, phase });
    } catch {
      signal?.throwIfAborted();
      if (page.isClosed()) throw new Error("Browser page closed during assertion");
      // Playwright errors can embed page text or URLs. Persist only controlled diagnostics.
      const matches = await locator.count().catch(() => undefined);
      const observed = matches !== undefined && matches > 1 && assertion.state !== "count" && assertion.state !== "textAbsent" ? `Expected ${expected}; the locator matched ${matches} elements and is ambiguous. Use an accessible name or unique test ID.` : `Expected ${expected}; the assertion did not succeed within ${timeout} ms.`;
      results.push({ expected, observed, passed: false, phase });
    }
  }
}
