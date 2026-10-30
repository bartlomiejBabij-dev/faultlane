import { describe, expect, it } from "vitest";
import { endpointMatcherSchema, endpointSchema, endpointsSchema, isLoopbackOrigin, jsonFixtureSchema, networkPolicySchema, originSchema, pathnameSchema, responseSchema, targetOverrideSchema, targetOverridesSchema } from "../../src/runner/endpoint-schema";
import { classifyNetworkRequest, findMatchingEndpoint, matchersOverlap, matchesEndpoint, validateEndpointConfiguration } from "../../src/runner/network-policy";
import { NetworkTracker } from "../../src/runner/network-tracker";
import { endpointResultSchema } from "../../src/runner/results";
import { RunnerIssue } from "../../src/runner/errors";

const baseUrl = "http://127.0.0.1:3000";
const apiOrigin = "http://127.0.0.1:4100";
const remoteOrigin = "https://example-test.supabase.co";
const policy = networkPolicySchema.parse({ mockOrigins: [apiOrigin, remoteOrigin], localOrigins: [apiOrigin], assets: [{ origin: "https://assets.example.test", pathname: "/fonts/*", resourceTypes: ["font", "stylesheet"] }] });
const projects = endpointSchema.parse({ id: "projects", match: { origin: apiOrigin, pathname: "/v1/projects", query: { state: "eq.open" } }, response: { type: "mock", json: [{ title: "Project fixture" }] }, maxRequests: 3 });
const profile = endpointSchema.parse({ id: "profile", match: { pathname: "/api/profile" }, response: { type: "forward" } });
const recovery = targetOverrideSchema.parse({ id: "projects", expectedRequests: 3, sequence: [{ type: "http-429" }, { type: "http-429", retryAfterSeconds: 2 }, { type: "mock", json: [{ title: "Recovered fixture" }] }] });

function captureIssue(run: () => void): RunnerIssue {
  try { run(); } catch (error) { expect(error).toBeInstanceOf(RunnerIssue); return error as RunnerIssue; }
  throw new Error("Expected a real validation failure");
}

describe("explicit endpoint schemas", () => {
  it("normalizes default ports and origin casing without allowing origin suffixes", () => {
    expect(originSchema.parse("HTTPS://EXAMPLE.TEST:443/")).toBe("https://example.test");
    expect(originSchema.parse("http://127.1:80")).toBe("http://127.0.0.1");
    expect(isLoopbackOrigin("http://localhost.evil.test")).toBe(false);
    expect(isLoopbackOrigin("http://[::1]:4100")).toBe(true);
  });
  it.each(["*", "https://*.example.test", "http:localhost", "file:///tmp/data", "http://user:secret@localhost", "https://example.test/path", "https://example.test?token=secret", "https://example.test#fragment", " https://example.test", "https://example.test\\other"])("rejects unsafe origin %s", (origin) => {
    expect(originSchema.safeParse(origin).success).toBe(false);
  });
  it.each(["api/items", "//example.test", "/api/*/items", "/api/**", "/api/../items", "/api/%2e%2e/items", "/api/%2fitems", "/api/%5citems", "/api/%zz", "/api/items?secret=value", "/api/item#fragment"])("rejects ambiguous path %s", (pathname) => {
    expect(pathnameSchema.safeParse(pathname).success).toBe(false);
  });
  it("accepts an exact path or a bounded trailing wildcard", () => {
    expect(pathnameSchema.parse("/rest/v1/projects")).toBe("/rest/v1/projects");
    expect(pathnameSchema.parse("/api/*")).toBe("/api/*");
    expect(pathnameSchema.parse("/")).toBe("/");
  });
  it("requires finite JSON fixtures and rejects executable, circular or oversized values", () => {
    const circular: { self?: unknown } = {}; circular.self = circular;
    for (const json of [undefined, () => 1, Infinity, new Date(), circular, "x".repeat(64_001)]) expect(jsonFixtureSchema.safeParse(json).success).toBe(false);
    expect(jsonFixtureSchema.safeParse({ data: [null, true, 3, "safe"] }).success).toBe(true);
  });
  it("requires bounded counts, unique IDs and an exact finite sequence length", () => {
    expect(endpointSchema.safeParse({ ...projects, expectedRequests: 4 }).success).toBe(false);
    expect(endpointSchema.safeParse({ ...projects, maxRequests: 0 }).success).toBe(false);
    expect(endpointsSchema.safeParse([projects, projects]).success).toBe(false);
    expect(targetOverrideSchema.safeParse({ ...recovery, expectedRequests: 2 }).success).toBe(false);
    expect(targetOverridesSchema.safeParse([recovery, recovery]).success).toBe(false);
    expect(targetOverrideSchema.safeParse({ ...recovery, sequence: [] }).success).toBe(false);
  });
  it("limits Supabase REST to GET collection arrays and keeps preflight outside endpoint counts", () => {
    const input = { ...projects, format: "supabase-rest" };
    expect(endpointSchema.safeParse(input).success).toBe(true);
    expect(endpointSchema.safeParse({ ...input, match: { ...projects.match, method: "POST" } }).success).toBe(false);
    expect(endpointSchema.safeParse({ ...input, response: { type: "mock", json: { item: 1 } } }).success).toBe(false);
    expect(endpointMatcherSchema.safeParse({ pathname: "/api/items", method: "OPTIONS" }).success).toBe(false);
    expect(responseSchema.safeParse({ type: "mock", status: 204, json: [] }).success).toBe(false);
  });
});

describe("origin, method, pathname and query matching", () => {
  it("matches only the exact normalized origin and HTTP method", () => {
    const matcher = endpointMatcherSchema.parse({ origin: "https://api.example.test:443", pathname: "/api/projects", method: "POST" });
    expect(matchesEndpoint("https://api.example.test/api/projects", "POST", matcher, baseUrl)).toBe(true);
    for (const url of ["http://api.example.test/api/projects", "https://api.example.test:444/api/projects", "https://api.example.test.evil.test/api/projects", "https://user:secret@api.example.test/api/projects"]) expect(matchesEndpoint(url, "POST", matcher, baseUrl)).toBe(false);
    expect(matchesEndpoint("https://api.example.test/api/projects", "GET", matcher, baseUrl)).toBe(false);
  });
  it("uses app origin for omitted origin and never matches unrelated paths or query text", () => {
    expect(matchesEndpoint(`${baseUrl}/api/profile`, "GET", profile.match, baseUrl)).toBe(true);
    for (const url of [`${apiOrigin}/api/profile`, `${baseUrl}/api/profile/extra`, `${baseUrl}/?q=/api/profile`]) expect(matchesEndpoint(url, "GET", profile.match, baseUrl)).toBe(false);
  });
  it("matches encoded query values exactly, independently of parameter order", () => {
    expect(matchesEndpoint(`${apiOrigin}/v1/projects?state=eq%2Eopen&select=id`, "GET", projects.match, baseUrl)).toBe(true);
    for (const query of ["state=eq.closed", "select=id", "state=eq.open&state=eq.closed", "state=eq.open&state=eq.open"]) expect(matchesEndpoint(`${apiOrigin}/v1/projects?${query}`, "GET", projects.match, baseUrl)).toBe(false);
  });
  it("matches descendants with /* but excludes the prefix itself and encoded separators", () => {
    const matcher = endpointMatcherSchema.parse({ pathname: "/api/*" });
    expect(matchesEndpoint(`${baseUrl}/api/items/42`, "GET", matcher, baseUrl)).toBe(true);
    for (const pathname of ["/apix/items", "/api", "/api/%2fsecret", "/api/%5csecret"]) expect(matchesEndpoint(`${baseUrl}${pathname}`, "GET", matcher, baseUrl)).toBe(false);
  });
  it("rejects overlapping paths but allows genuinely disjoint exact query conditions", () => {
    const broad = endpointMatcherSchema.parse({ pathname: "/api/*" });
    expect(matchersOverlap(broad, profile.match, baseUrl)).toBe(true);
    expect(matchersOverlap(broad, endpointMatcherSchema.parse({ pathname: "/api/nested/*" }), baseUrl)).toBe(true);
    expect(matchersOverlap(broad, endpointMatcherSchema.parse({ pathname: "/other/*" }), baseUrl)).toBe(false);
    const one = endpointMatcherSchema.parse({ pathname: "/api/items", query: { group: "one" } });
    const two = endpointMatcherSchema.parse({ pathname: "/api/items", query: { group: "two" } });
    expect(matchersOverlap(one, two, baseUrl)).toBe(false);
    expect(matchersOverlap(one, endpointMatcherSchema.parse({ pathname: "/api/items", query: { other: "two" } }), baseUrl)).toBe(true);
  });
  it("chooses the independent target without a shared global match", () => {
    expect(findMatchingEndpoint(`${apiOrigin}/v1/projects?state=eq.open`, "GET", [profile, projects], baseUrl)?.id).toBe("projects");
    expect(findMatchingEndpoint(`${baseUrl}/api/profile`, "GET", [profile, projects], baseUrl)?.id).toBe("profile");
  });
});

describe("network policy validation and default denial", () => {
  it("requires a separate cross-origin interception permission even on loopback", () => {
    expect(validateEndpointConfiguration([projects], baseUrl, networkPolicySchema.parse({}))).toHaveLength(1);
    expect(validateEndpointConfiguration([projects, profile], baseUrl, policy)).toEqual([]);
  });
  it("never treats remote mocking permission as permission to forward a request", () => {
    const endpoint = endpointSchema.parse({ ...projects, match: { ...projects.match, origin: remoteOrigin }, response: { type: "forward" } });
    expect(validateEndpointConfiguration([endpoint], baseUrl, policy).some((issue) => issue.message.includes("External API forwarding"))).toBe(true);
    const mock = endpointSchema.parse({ ...endpoint, response: { type: "mock", json: [] } });
    const slowForward = targetOverrideSchema.parse({ id: "projects", expectedRequests: 1, sequence: [{ type: "slow", delayMs: 500, response: { type: "forward" } }] });
    expect(validateEndpointConfiguration([mock], baseUrl, policy, [slowForward])).toHaveLength(1);
    expect(networkPolicySchema.safeParse({ localOrigins: [remoteOrigin] }).success).toBe(false);
  });
  it("requires explicit loopback forwarding permission and blocks mutating forwarding", () => {
    const endpoint = endpointSchema.parse({ ...projects, response: { type: "forward" } });
    expect(validateEndpointConfiguration([endpoint], baseUrl, policy)).toEqual([]);
    expect(validateEndpointConfiguration([endpoint], baseUrl, { ...policy, localOrigins: [] })).toHaveLength(1);
    const post = endpointSchema.parse({ ...endpoint, match: { ...endpoint.match, method: "POST" } });
    expect(validateEndpointConfiguration([post], baseUrl, policy)).toHaveLength(1);
    expect(validateEndpointConfiguration([endpointSchema.parse({ ...post, response: { type: "mock", json: [] } })], baseUrl, policy)).toEqual([]);
  });
  it("detects conflicting matcher definitions, missing target IDs and oversized sequences", () => {
    expect(validateEndpointConfiguration([profile, endpointSchema.parse({ ...profile, id: "shadow", match: { pathname: "/api/*" } })], baseUrl, policy)).toHaveLength(1);
    expect(validateEndpointConfiguration([profile], baseUrl, policy, [recovery])).toHaveLength(1);
    expect(validateEndpointConfiguration([endpointSchema.parse({ ...projects, maxRequests: 2 })], baseUrl, policy, [recovery])).toHaveLength(1);
  });
  it.each(["fetch", "xhr", "eventsource"])("blocks unmatched %s for remote, loopback and same-origin destinations", (resourceType) => {
    for (const origin of [baseUrl, apiOrigin, remoteOrigin]) expect(classifyNetworkRequest(`${origin}/api/unlisted`, "GET", resourceType, baseUrl, policy).kind).toBe("blocked");
  });
  it("permits only explicitly listed asset resource types and paths", () => {
    expect(classifyNetworkRequest("https://assets.example.test/fonts/inter.woff2", "GET", "font", baseUrl, policy).kind).toBe("allowed-asset");
    expect(classifyNetworkRequest("https://assets.example.test/fonts/styles.css", "GET", "stylesheet", baseUrl, policy).kind).toBe("allowed-asset");
    for (const [url, method, type] of [["https://assets.example.test/fonts/inter.woff2", "GET", "fetch"], ["https://assets.example.test/fonts/code.js", "GET", "script"], ["https://assets.example.test/api/private", "GET", "font"], ["https://assets.example.test/fonts/inter.woff2", "POST", "font"], ["https://assets.example.test.evil.test/fonts/inter.woff2", "GET", "font"]]) expect(classifyNetworkRequest(url!, method!, type!, baseUrl, policy).kind).toBe("blocked");
  });
  it("allows local application documents and scripts without authorizing another local service", () => {
    expect(classifyNetworkRequest(`${baseUrl}/dashboard`, "GET", "document", baseUrl, policy).kind).toBe("same-origin");
    expect(classifyNetworkRequest(`${baseUrl}/assets/app.js`, "GET", "script", baseUrl, policy).kind).toBe("same-origin");
    expect(classifyNetworkRequest(`${baseUrl}/@vite/client`, "GET", "script", baseUrl, policy).kind).toBe("same-origin");
    expect(classifyNetworkRequest(`${baseUrl}/_next/static/chunks/[root]__123.js`, "GET", "script", baseUrl, policy).kind).toBe("same-origin");
    expect(classifyNetworkRequest(`${apiOrigin}/assets/app.js`, "GET", "script", baseUrl, policy).kind).toBe("blocked");
    expect(classifyNetworkRequest("file:///secret", "GET", "document", baseUrl, policy).kind).toBe("blocked");
  });
});

describe("independent request counters and finite response sequences", () => {
  it("reserves per-endpoint ordinals before concurrent responses finish", () => {
    const tracker = new NetworkTracker([projects, profile], baseUrl, [recovery]);
    tracker.observe(`${apiOrigin}/v1/projects?state=eq.open`, "GET");
    const first = tracker.begin("projects")!;
    tracker.observe(`${baseUrl}/api/profile`, "GET");
    const other = tracker.begin("profile")!;
    tracker.observe(`${apiOrigin}/v1/projects?state=eq.open`, "GET");
    const second = tracker.begin("projects")!;
    tracker.complete("projects", second.record, "simulated", 429);
    tracker.complete("profile", other.record, "forwarded", 200);
    tracker.complete("projects", first.record, "simulated", 429);
    tracker.observe(`${apiOrigin}/v1/projects?state=eq.open`, "GET");
    const third = tracker.begin("projects")!;
    tracker.complete("projects", third.record, "mocked", 200);
    expect([first.record.ordinal, second.record.ordinal, third.record.ordinal, other.record.ordinal]).toEqual([1, 2, 3, 1]);
    expect(third.record.phase).toBe("recovery");
    expect(tracker.ready()).toBe(true);
    expect(() => tracker.validateCoverage()).not.toThrow();
    expect(tracker.summary().map((state) => [state.id, state.interceptedRequests, state.faultedRequests])).toEqual([["projects", 3, 2], ["profile", 1, 0]]);
  });
  it("does not count wrong origins, methods or query values", () => {
    const tracker = new NetworkTracker([projects], baseUrl);
    tracker.observe(`${baseUrl}/v1/projects?state=eq.open`, "GET");
    tracker.observe(`${apiOrigin}/v1/projects?state=eq.closed`, "GET");
    tracker.observe(`${apiOrigin}/v1/projects?state=eq.open`, "POST");
    expect(tracker.summary()[0]?.observedRequests).toBe(0);
    expect(captureIssue(() => tracker.validateCoverage())).toMatchObject({ status: "ERROR", code: "API_NOT_OBSERVED" });
  });
  it("never accepts visible recovery with a missing required request", () => {
    const tracker = new NetworkTracker([projects], baseUrl, [recovery]);
    tracker.observe(`${apiOrigin}/v1/projects?state=eq.open`, "GET");
    const first = tracker.begin("projects")!;
    tracker.complete("projects", first.record, "simulated", 429);
    expect(tracker.ready()).toBe(false);
    expect(captureIssue(() => tracker.validateCoverage())).toMatchObject({ status: "FAIL", code: "RESPONSE_SEQUENCE_INCOMPLETE" });
  });
  it("blocks requests after a response sequence without silently repeating its final success", () => {
    const tracker = new NetworkTracker([projects], baseUrl, [targetOverrideSchema.parse({ id: "projects", expectedRequests: 1, sequence: [{ type: "http-500" }] })]);
    tracker.begin("projects");
    expect(tracker.begin("projects")).toBeUndefined();
    expect(tracker.issue).toMatchObject({ status: "FAIL", code: "RESPONSE_SEQUENCE_EXHAUSTED" });
    expect(tracker.summary()[0]?.requests[1]?.outcome).toBe("blocked");
  });
  it("bounds request storms and record allocation independently", () => {
    const tracker = new NetworkTracker([projects, profile], baseUrl);
    for (let index = 0; index < 100; index++) { tracker.observe(`${apiOrigin}/v1/projects?state=eq.open`, "GET"); tracker.begin("projects"); }
    expect(tracker.issue?.code).toBe("REQUEST_LIMIT_EXCEEDED");
    expect(tracker.summary()[0]).toMatchObject({ observedRequests: 100, interceptedRequests: 100, blockedRequests: 97 });
    expect(tracker.summary()[0]?.requests).toHaveLength(4);
    expect(tracker.summary()[1]?.interceptedRequests).toBe(0);
  });
  it("requires every matched request to finish and reports timeout as ERROR", () => {
    const tracker = new NetworkTracker([profile], baseUrl, [], "baseline");
    tracker.observe(`${baseUrl}/api/profile`, "GET"); tracker.begin("profile");
    expect(tracker.ready()).toBe(false);
    expect(captureIssue(() => tracker.validateCoverage())).toMatchObject({ status: "ERROR", code: "API_REQUEST_TIMEOUT" });
  });
  it("does not accept extra completed baseline requests below the hard limit", () => {
    const tracker = new NetworkTracker([profile], baseUrl, [], "baseline");
    for (let index = 0; index < 2; index++) { tracker.observe(`${baseUrl}/api/profile`, "GET"); const next = tracker.begin("profile")!; tracker.complete("profile", next.record, "forwarded", 200); }
    expect(captureIssue(() => tracker.validateCoverage())).toMatchObject({ status: "FAIL", code: "ENDPOINT_REQUEST_COUNT" });
  });
  it("counts executed slow responses whether mocked or safely forwarded, exactly once", () => {
    for (const type of ["mock", "forward"] as const) {
      const sequence = targetOverrideSchema.parse({ id: "profile", expectedRequests: 1, sequence: [{ type: "slow", delayMs: 500, response: type === "mock" ? { type: "mock", json: [] } : { type: "forward" } }] });
      const tracker = new NetworkTracker([profile], baseUrl, [sequence]);
      tracker.observe(`${baseUrl}/api/profile`, "GET"); const next = tracker.begin("profile")!;
      tracker.complete("profile", next.record, type === "mock" ? "simulated" : "forwarded", 200);
      tracker.complete("profile", next.record, "forwarded", 200);
      expect(tracker.summary()[0]?.faultedRequests).toBe(1);
      expect(() => tracker.validateCoverage()).not.toThrow();
    }
  });
  it("requires the configured fault response to have actually been injected", () => {
    const sequence = targetOverrideSchema.parse({ id: "profile", expectedRequests: 1, sequence: [{ type: "http-500" }] });
    const tracker = new NetworkTracker([profile], baseUrl, [sequence]);
    tracker.observe(`${baseUrl}/api/profile`, "GET"); const next = tracker.begin("profile")!;
    tracker.complete("profile", next.record, "simulated", 200);
    expect(captureIssue(() => tracker.validateCoverage())).toMatchObject({ status: "ERROR", code: "FAULT_COVERAGE_INCOMPLETE" });
  });
  it("rejects an unsuccessful forwarded recovery response", () => {
    const sequence = targetOverrideSchema.parse({ id: "profile", expectedRequests: 2, sequence: [{ type: "http-500" }, { type: "forward" }] });
    const tracker = new NetworkTracker([profile], baseUrl, [sequence]);
    tracker.observe(`${baseUrl}/api/profile`, "GET"); const first = tracker.begin("profile")!; tracker.complete("profile", first.record, "simulated", 500);
    tracker.observe(`${baseUrl}/api/profile`, "GET"); const second = tracker.begin("profile")!; tracker.complete("profile", second.record, "forwarded", 503);
    expect(captureIssue(() => tracker.validateCoverage())).toMatchObject({ status: "FAIL", code: "RECOVERY_HTTP_STATUS" });
  });
  it("writes schema-valid summaries without fixture bodies or query values", () => {
    const endpoint = endpointSchema.parse({ ...projects, match: { ...projects.match, query: { access_token: "synthetic-secret", ["a".repeat(90)]: "another-secret" } } });
    const tracker = new NetworkTracker([endpoint], baseUrl, [recovery]);
    const result = tracker.summary()[0]!;
    expect(endpointResultSchema.safeParse(result).success).toBe(true);
    const serialized = JSON.stringify(result);
    for (const omitted of ["synthetic-secret", "another-secret", "Project fixture", "Recovered fixture"]) expect(serialized).not.toContain(omitted);
    expect(result.queryKeys).toEqual(["[redacted-key]", "access_token"]);
  });
});
