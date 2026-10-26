import { setTimeout as delay } from "node:timers/promises";
import type { Route } from "@playwright/test";
import { type Scenario } from "./config";

export const scenarioLabels = {
  baseline: "Baseline · no fault",
  "http-500": "HTTP 500 · server error",
  "http-429": "HTTP 429 · rate limit",
  slow: "Slow API response",
  network: "Network failure",
  empty: "Empty data",
} as const;

export function simulatedResponse(scenario: Scenario) {
  switch (scenario.id) {
    case "http-500": return { status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated server error" }) };
    case "http-429": return { status: 429, contentType: "application/json", headers: { "Retry-After": String(scenario.retryAfterSeconds) }, body: JSON.stringify({ error: "Simulated rate limit" }) };
    case "empty": return { status: 200, contentType: "application/json", body: "[]" };
    default: return null;
  }
}

// Do not let route.fetch follow an unchecked redirect to a non-local origin.
export async function forwardLocal(route: Route, timeout: number) {
  const response = await route.fetch({ timeout, maxRedirects: 0, maxRetries: 0 });
  try {
    const location = response.headers()["location"];
    // Browsers can follow a fulfilled 3xx without calling the route handler again.
    // Reject redirects entirely in the MVP, including multi-hop local chains.
    if (response.status() >= 300 && response.status() < 400 && location) {
      await route.abort("blockedbyclient");
      throw new Error("Redirect blocked; configure the final local URL directly");
    }
    await route.fulfill({ response });
  } finally { await response.dispose(); }
}

export async function simulate(route: Route, scenario: Scenario, timeout: number, signal: AbortSignal) {
  const response = simulatedResponse(scenario);
  if (response) { await route.fulfill(response); return; }
  if (scenario.id === "network") { await route.abort("failed"); return; }
  if (scenario.id === "slow") await delay(scenario.delayMs, undefined, { signal });
  await forwardLocal(route, timeout);
}
