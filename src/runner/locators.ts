import type { Page } from "@playwright/test";
import type { Assertion, LocatorConfig } from "./journey-schema";

export function locate(page: Page, locator: LocatorConfig) {
  switch (locator.by) {
    case "testId": return page.getByTestId(locator.value);
    case "label": return page.getByLabel(locator.value, { exact: true });
    case "role": return page.getByRole(locator.role, { name: locator.name, exact: true });
  }
}
export function assertionLocator(assertion: Assertion): LocatorConfig {
  return assertion.locator ?? { by: "testId", value: assertion.testId! };
}
export function describeLocator(locator: LocatorConfig): string {
  if (locator.by === "testId") return `[data-testid="${locator.value}"]`;
  if (locator.by === "label") return `input labelled “${locator.value}”`;
  return `role ${locator.role}${locator.name ? ` named “${locator.name}”` : ""}`;
}
