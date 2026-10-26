import { describe, expect, it } from "vitest";
import legacy from "../../faultlane.config";
import recovery from "../../faultlane.recovery.config";
import { actionSchema, locatorSchema } from "../../src/runner/journey-schema";
import { configSchema } from "../../src/runner/config";
import { RequestTracker } from "../../src/runner/requests";
import { describeAction } from "../../src/runner/actions";
import { runResultSchema, evidencePattern } from "../../src/runner/results";

describe("journey configuration", () => {
  it("keeps v0.1 configs compatible and validates explicit recovery", () => {
    expect(configSchema.parse(legacy)).toEqual(legacy);
    expect(configSchema.parse(recovery).scenarios[0]?.affectRequests).toBe(1);
  });
  it.each(["https://example.com", "//example.com", "/\\example.com", "/\n/evil"])("rejects unsafe action navigation %s", (path) => {
    expect(actionSchema.safeParse({ type: "navigate", path }).success).toBe(false);
  });
  it("rejects CSS, scripts, unbounded waits and ambiguous role clicks", () => {
    expect(locatorSchema.safeParse({ by: "css", value: "button:nth-child(3)" }).success).toBe(false);
    expect(actionSchema.safeParse({ type: "evaluate", script: "alert(1)" }).success).toBe(false);
    expect(actionSchema.safeParse({ type: "click", locator: { by: "role", role: "button" } }).success).toBe(false);
    expect(actionSchema.safeParse({ type: "navigate", path: "/", timeoutMs: 0 }).success).toBe(false);
  });
  it("requires bounded fault count and a single recovery click before waits", () => {
    const scenario = recovery.scenarios[0]!;
    expect(configSchema.safeParse({ ...recovery, scenarios: [{ ...scenario, affectRequests: undefined }] }).success).toBe(false);
    expect(configSchema.safeParse({ ...recovery, maxRequests: 2, scenarios: [{ ...scenario, affectRequests: 2 }] }).success).toBe(false);
    expect(configSchema.safeParse({ ...recovery, scenarios: [{ ...scenario, recovery: { ...scenario.recovery, actions: [] } }] }).success).toBe(false);
    expect(configSchema.safeParse({ ...recovery, scenarios: [{ ...scenario, recovery: { ...scenario.recovery, actions: [{ type: "navigate", path: "/" }] } }] }).success).toBe(false);
  });
  it("omits typed input values and navigation queries from step descriptions", () => {
    expect(describeAction({ type: "fill", locator: { by: "label", value: "Category" }, value: "private-value" })).not.toContain("private-value");
    expect(describeAction({ type: "navigate", path: "/catalog?token=secret" })).not.toContain("secret");
  });
  it("only accepts safe screenshot filenames", () => {
    expect(evidencePattern.test("http-500-step-010.png")).toBe(true);
    expect(evidencePattern.test("../../http-500-step-010.png")).toBe(false);
    expect(evidencePattern.test("http-500-step-010.svg")).toBe(false);
    expect(runResultSchema.safeParse({ schemaVersion: 99 }).success).toBe(false);
  });
});

describe("request accounting", () => {
  it("reserves each ordinal before asynchronous response completion", () => {
    const tracker = new RequestTracker(recovery, recovery.scenarios[0]!, []);
    const first = tracker.begin();
    expect(first.ordinal).toBe(1);
    first.outcome = "simulated";
    tracker.faulted++;
    tracker.armRecovery();
    const second = tracker.begin();
    expect(second.ordinal).toBe(2);
    expect(second.phase).toBe("recovery");
    tracker.check();
    expect(tracker.records).toHaveLength(2);
  });
  it("rejects a pre-retry request and caps retry storms", () => {
    const tracker = new RequestTracker(recovery, recovery.scenarios[0]!, []);
    tracker.begin(); tracker.begin();
    expect(tracker.issue?.code).toBe("REQUEST_BEFORE_RETRY");
    for (let i = 0; i < 100; i++) tracker.begin();
    expect(tracker.intercepted).toBe(3);
    expect(tracker.records).toHaveLength(3);
  });
  it("does not count another loopback origin as target coverage", () => {
    const tracker = new RequestTracker(recovery, recovery.scenarios[0]!, []);
    tracker.observe("http://127.0.0.1:3999/api/demo/projects", "GET");
    expect(tracker.observed).toBe(0);
    tracker.observe(`${recovery.baseUrl}/api/demo/projects`, "GET");
    expect(tracker.observed).toBe(1);
  });
});
