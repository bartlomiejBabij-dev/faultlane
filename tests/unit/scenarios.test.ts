import { describe, expect, it, vi } from "vitest";
import type { Route } from "@playwright/test";
import config from "../../faultlane.config";
import { forwardLocal, simulate, simulatedResponse } from "../../src/runner/scenarios";

describe("HTTP simulations", () => {
  it("uses 500 JSON, 429 Retry-After and exactly an empty JSON array", () => {
    const responses = config.scenarios.map(simulatedResponse);
    expect(responses[0]).toMatchObject({ status: 500, contentType: "application/json" });
    expect(responses[1]).toMatchObject({ status: 429, headers: { "Retry-After": "30" } });
    expect(responses[4]).toMatchObject({ status: 200, body: "[]" });
  });
  it("aborts a network failure instead of fulfilling an HTTP error", async () => {
    const route = { abort: vi.fn(), fulfill: vi.fn() };
    await simulate(route as unknown as Route, { id: "network", assertions: [] }, 1000, new AbortController().signal);
    expect(route.abort).toHaveBeenCalledWith("failed");
    expect(route.fulfill).not.toHaveBeenCalled();
  });
  it("waits the configured slow delay and then forwards the real response", async () => {
      const response = { headers: () => ({}), status: () => 200, dispose: vi.fn() };
      const route = { fetch: vi.fn().mockResolvedValue(response), fulfill: vi.fn() };
      const slow = config.scenarios.find((s) => s.id === "slow")!;
      const started = performance.now();
      const pending = simulate(route as unknown as Route, slow, 1000, new AbortController().signal);
      expect(route.fetch).not.toHaveBeenCalled();
      await pending;
      expect(performance.now() - started).toBeGreaterThanOrEqual(2950);
      expect(route.fetch).toHaveBeenCalledWith({ timeout: 1000, maxRedirects: 0, maxRetries: 0 });
      expect(route.fulfill).toHaveBeenCalledWith({ response });
  });
  it.each(["https://example.com/secret", "http://localhost/redirect-again"])("does not follow redirect %s", async (location) => {
    const response = { headers: () => ({ location }), status: () => 302, dispose: vi.fn() };
    const route = { fetch: vi.fn().mockResolvedValue(response), abort: vi.fn(), fulfill: vi.fn() };
    await expect(forwardLocal(route as unknown as Route, 1000)).rejects.toThrow("Redirect blocked");
    expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(route.fulfill).not.toHaveBeenCalled();
    expect(response.dispose).toHaveBeenCalled();
  });
});
