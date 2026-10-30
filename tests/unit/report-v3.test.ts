import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listReports } from "../../src/lib/report-store";
import { safeRequestMetadata, sanitizeMetadataText, sanitizePathname, sanitizeQueryKeys } from "../../src/runner/network-redaction";
import { markdownReport, writeReport } from "../../src/runner/report";
import { networkEventSchema, runResultSchema, type RunResult } from "../../src/runner/results";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

function sample(): RunResult {
  const metadata = safeRequestMetadata("https://synthetic.invalid/rest/v1/tasks?select=id,title&apikey=synthetic-secret&owner=eq.synthetic-owner", "GET", "fetch");
  return {
    schemaVersion: 3, id: "20261028T120000000Z-1234abcd", startedAt: "2026-10-28T12:00:00.000Z", application: "http://127.0.0.1:3000/tasks", apiPattern: "1 configured endpoint", durationMs: 600,
    results: [{
      id: "http-500", status: "PASS", durationMs: 600, observedRequests: 2, interceptedRequests: 2, faultedRequests: 1,
      assertions: [{ expected: "Task list recovered", observed: "Synthetic task is visible", passed: true, phase: "recovery" }], observation: "Recovery assertions passed.", suggestion: "Inspect only if behavior changes.", screenshot: "http-500.png", loadingScreenshot: null, diagnostics: [],
      endpoints: [{
        id: "tasks", origin: metadata.origin, pathname: metadata.pathname, queryKeys: metadata.queryKeys, method: "GET", expectedRequests: 2, maxRequests: 2, observedRequests: 2, interceptedRequests: 2, blockedRequests: 0, faultedRequests: 1,
        expectedSequence: [{ ordinal: 1, action: "http-500", status: 500 }, { ordinal: 2, action: "mock", status: 200 }],
        requests: [{ ordinal: 1, phase: "fault", outcome: "simulated", status: 500, fault: true }, { ordinal: 2, phase: "recovery", outcome: "mocked", status: 200, fault: false }],
      }],
      network: { policy: "explicit-origins", observedRequests: 3, blockedRequests: 1, allowedRequests: 0, mockedRequests: 2, events: [{ ...metadata, endpointId: "tasks", decision: "mocked" }, { ...safeRequestMetadata("https://unconfigured.invalid/collect?token=private-query", "POST", "fetch"), decision: "blocked" }], truncated: false, zeroMatchTargets: [], warnings: ["Service workers are blocked."], hypotheses: ["A blocked dependency could affect the UI; this has not been established."], nextActions: ["Inspect configured origins and browser request methods."] },
    }],
  };
}

describe("network metadata privacy", () => {
  it("removes all query values, credentials and fragments while preserving useful matching metadata", () => {
    const result = safeRequestMetadata("https://user:password@SYNTHETIC.invalid:443/rest/v1/tasks?access_token=secret-value&filter=private-filter&filter=second#private-fragment", "GET", "fetch");
    expect(result).toEqual({ origin: "https://synthetic.invalid", pathname: "/rest/v1/tasks", queryKeys: ["access_token", "filter"], method: "GET", resourceType: "fetch" });
    expect(JSON.stringify(result)).not.toMatch(/password|secret-value|private-filter|private-fragment|second/);
  });
  it("keeps query keys bounded, unique and safe even for malformed or encoded names", () => {
    const keys = sanitizeQueryKeys(["token", "token", "\nsecret", "a".repeat(65), "filter[id]", "tenant.id"]);
    expect(keys).toEqual(["[redacted-key]", "filter[id]", "tenant.id", "token"]);
    expect(sanitizeQueryKeys(Array.from({ length: 100 }, (_, index) => `key${index}`))).toHaveLength(30);
  });
  it.each(["data:text/plain,private-body", "javascript:private-code", "file:///private/path"])("does not retain non-HTTP URL contents: %s", (url) => {
    expect(safeRequestMetadata(url, "GET", "document")).toEqual({ origin: "[non-http]", pathname: "[omitted]", queryKeys: [], method: "GET", resourceType: "document" });
  });
  it("uses fixed fallback metadata for invalid URLs or method/resource injection", () => {
    expect(safeRequestMetadata("private-invalid-url", "GET\nAuthorization", "fetch\nprivate")).toEqual({ origin: "[invalid URL]", pathname: "[omitted]", queryKeys: [], method: "OTHER", resourceType: "other" });
  });
  it("sanitizes pathname control characters, queries, fragments and excessive lengths", () => {
    expect(sanitizePathname("/rest/%0a/tasks?token=private#secret")).toBe("/rest/_/tasks");
    expect(sanitizePathname("/tasks\nprivate")).toBe("/tasks private");
    expect(sanitizePathname("/" + "x".repeat(1000))).toHaveLength(500);
    expect(sanitizeMetadataText("A\u001bB\nC", 3)).toBe("A B");
  });
});

describe("schema version 3 evidence", () => {
  it("retains independent sequences and meaningful network decisions", () => {
    const run = runResultSchema.parse(sample());
    expect(run.results[0]?.endpoints?.[0]?.requests.map((request) => request.outcome)).toEqual(["simulated", "mocked"]);
    expect(run.results[0]?.network?.events[1]?.decision).toBe("blocked");
  });
  it.each(["endpoints", "network"] as const)("rejects version 3 without %s evidence", (field) => {
    const run = sample();
    delete run.results[0]![field];
    expect(runResultSchema.safeParse(run).success).toBe(false);
  });
  it("rejects zero expected interceptions and unbounded event evidence", () => {
    const run = sample();
    run.results[0]!.endpoints![0]!.expectedRequests = 0;
    expect(runResultSchema.safeParse(run).success).toBe(false);
    const network = sample().results[0]!.network!;
    network.events = Array.from({ length: 201 }, () => network.events[0]!);
    expect(runResultSchema.safeParse({ ...sample(), results: [{ ...sample().results[0], network }] }).success).toBe(false);
  });
  it.each([
    { pathname: "/rest/v1/tasks?token=private" },
    { origin: "https://user:password@synthetic.invalid" },
    { queryKeys: ["token=private"] },
    { authorization: "private" },
    { responseBody: { confidential: "private" } },
  ])("rejects unsafe network evidence %#", (extra) => {
    expect(networkEventSchema.safeParse({ ...sample().results[0]!.network!.events[0], ...extra }).success).toBe(false);
  });
  it("renders endpoint counters, sequences, blocked calls, hypotheses and coverage warnings", () => {
    const markdown = markdownReport(sample());
    for (const expected of ["Endpoint coverage", "Expected requests: 2; limit: 2", "Expected response sequence", "Actual response sequence", "mocked, HTTP 200", "explicit-origins", "blocked", "Hypotheses — not verified causes", "Service workers are blocked", "All query values"]) {
      expect(markdown.toLowerCase()).toContain(expected.toLowerCase());
    }
    expect(markdown).not.toMatch(/synthetic-secret|synthetic-owner|private-query|id,title/);
  });
  it("escapes endpoint identifiers and hypotheses in Markdown", () => {
    const run = sample();
    run.results[0]!.endpoints![0]!.id = "<img src=x>";
    run.results[0]!.network!.hypotheses = ["<script>unsafe</script>"];
    const markdown = markdownReport(run);
    expect(markdown).not.toContain("<img src=x>");
    expect(markdown).toContain("\\<img src=x\\>");
    expect(markdown).not.toContain("<script>");
  });
  it("reads v1, v2 and v3 together without rewriting historical bytes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "faultlane-report-v3-")); temporary.push(directory);
    const runs = [1, 2, 3].map((version) => {
      const run = sample(); run.schemaVersion = version as 1 | 2 | 3; run.id = `20261028T12000${version}000Z-1234abcd`;
      if (version < 3) { delete run.results[0]!.endpoints; delete run.results[0]!.network; }
      return run;
    });
    for (const run of runs) await writeReport(path.join(directory, run.id), run);
    const files = runs.map((run) => path.join(directory, run.id, "results.json"));
    const before = await Promise.all(files.map((file) => readFile(file)));
    const listed = await listReports(directory);
    expect(listed.skipped).toBe(0);
    expect(listed.runs.map((run) => run.schemaVersion)).toEqual([3, 2, 1]);
    expect(await Promise.all(files.map((file) => readFile(file)))).toEqual(before);
    expect(Buffer.concat(before).toString()).not.toMatch(/synthetic-secret|synthetic-owner|private-query/);
  });
});
