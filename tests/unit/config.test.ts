import { describe, expect, it } from "vitest";
import config from "../../faultlane.config";
import { configSchema, isLoopbackUrl, matchesApi, selectScenarios } from "../../src/runner/config";

describe("configuration validation and target safety", () => {
  it("validates the demo and exactly five distinct failure modes", () => {
    expect(configSchema.parse(config).scenarios.map((scenario) => scenario.id)).toEqual(["http-500", "http-429", "slow", "network", "empty"]);
  });
  it.each(["not a url", "https://example.com", "http://localhost.evil.test", "http://192.168.1.3", "file:///etc/passwd", "http://user:secret@localhost", "http://[::]", "http://[2001:db8::1]"])("rejects unsafe target %s", (baseUrl) => {
    expect(isLoopbackUrl(baseUrl)).toBe(false);
    expect(configSchema.safeParse({ ...config, baseUrl }).success).toBe(false);
  });
  it.each(["http://localhost:3000", "http://127.0.0.1:8080", "http://127.42.0.3", "http://[::1]:3000"])("accepts loopback %s", (url) => expect(isLoopbackUrl(url)).toBe(true));
  it.each(["//example.com", "/\\example.com", "https://example.com", "/ demo", "/\n/example.com"])("rejects escaping page path %s", (pagePath) => expect(configSchema.safeParse({ ...config, pagePath }).success).toBe(false));
  it("rejects missing, only negative, duplicate and unbounded expectations", () => {
    expect(configSchema.safeParse({ ...config, baseline: { assertions: [] } }).success).toBe(false);
    expect(configSchema.safeParse({ ...config, baseline: { assertions: [{ testId: "error", state: "hidden" }] } }).success).toBe(false);
    expect(configSchema.safeParse({ ...config, scenarios: [config.scenarios[0], config.scenarios[0]] }).success).toBe(false);
    expect(configSchema.safeParse({ ...config, timeouts: { ...config.timeouts, assertionMs: 0 } }).success).toBe(false);
    const slow = config.scenarios.find((scenario) => scenario.id === "slow")!;
    expect(configSchema.safeParse({ ...config, scenarios: [{ ...slow, delayMs: 100_000 }] }).success).toBe(false);
    expect(configSchema.safeParse({ ...config, scenarios: [{ ...slow, duringDelay: [] }] }).success).toBe(false);
  });
  it("does not support an external-target bypass or mutating API method", () => {
    expect(configSchema.safeParse({ ...config, allowExternal: true }).success).toBe(false);
    expect(configSchema.safeParse({ ...config, api: { ...config.api, method: "POST" } }).success).toBe(false);
  });
  it("matches pathname wildcards, not arbitrary prefixes or query text", () => {
    expect(matchesApi("http://localhost/api/demo/projects?token=ignored", config.api)).toBe(true);
    expect(matchesApi("http://localhost/api/demo/projects/extra", config.api)).toBe(false);
    expect(matchesApi("http://localhost/api/v1/projects", { method: "GET", pathname: "/api/*/projects" })).toBe(true);
    expect(matchesApi("http://localhost/?q=/api/demo/projects", config.api)).toBe(false);
  });
});

describe("scenario selection", () => {
  it("always includes a baseline", () => {
    expect(selectScenarios(config).map((s) => s.id)).toHaveLength(6);
    expect(selectScenarios(config, "http-500").map((s) => s.id)).toEqual(["baseline", "http-500"]);
    expect(selectScenarios(config, "baseline").map((s) => s.id)).toEqual(["baseline"]);
  });
  it("rejects unknown or unconfigured scenarios", () => {
    expect(() => selectScenarios(config, "typo")).toThrow();
    expect(() => selectScenarios({ ...config, scenarios: config.scenarios.filter((s) => s.id !== "network") }, "network")).toThrow();
  });
});
