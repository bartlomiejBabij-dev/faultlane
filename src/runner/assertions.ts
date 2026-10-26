import { expect, type Page } from "@playwright/test";
import type { Assertion } from "./config";
import type { AssertionResult } from "./results";

export function describeAssertion(assertion: Assertion) {
  const target = `[data-testid="${assertion.testId}"]`;
  switch (assertion.state) {
    case "visible": return `${target} is visible`;
    case "hidden": return `${target} is hidden or absent`;
    case "text": return `${target} is visible and contains “${assertion.text}”`;
    case "count": return `${target} has ${assertion.count} matching element(s)`;
  }
}

export async function checkAssertions(page: Page, assertions: Assertion[], timeout: number, phase: AssertionResult["phase"], results: AssertionResult[], signal?: AbortSignal) {
  for (const assertion of assertions) {
    signal?.throwIfAborted();
    const expected = describeAssertion(assertion);
    const locator = page.getByTestId(assertion.testId);
    try {
      switch (assertion.state) {
        case "visible": await expect(locator).toBeVisible({ timeout }); break;
        case "hidden": await expect(locator).toBeHidden({ timeout }); break;
        case "text": await expect(locator).toBeVisible({ timeout }); await expect(locator).toContainText(assertion.text, { timeout }); break;
        case "count": await expect(locator).toHaveCount(assertion.count, { timeout }); break;
      }
      results.push({ expected, observed: `Verified: ${expected}.`, passed: true, phase });
    } catch {
      signal?.throwIfAborted();
      // Playwright errors can embed page text or URLs. Persist only controlled diagnostics.
      results.push({ expected, observed: `Expected ${expected}; the assertion did not succeed within ${timeout} ms.`, passed: false, phase });
    }
  }
}
