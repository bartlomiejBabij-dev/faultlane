import { expect } from "@playwright/test";
import { matchesApi, type Action, type FaultLaneConfig, type Scenario } from "./config";
import { RunnerIssue } from "./errors";
import type { RequestResult } from "./results";

export class RequestTracker {
  observed = 0;
  intercepted = 0;
  faulted = 0;
  firstAt = 0;
  recovering = false;
  issue?: RunnerIssue;
  records: RequestResult[] = [];
  private readonly watched = new Map<string, { request: FaultLaneConfig["api"]; count: number }>();
  readonly limit: number;
  readonly affected: number;
  constructor(private readonly config: FaultLaneConfig, private readonly scenario: Scenario, actions: Action[]) {
    this.limit = config.maxRequests ?? 20;
    this.affected = scenario.id === "baseline" ? 0 : scenario.affectRequests ?? Infinity;
    for (const action of actions) if (action.type === "waitForRequest") this.watched.set(JSON.stringify(action.request), { request: action.request, count: 0 });
  }
  matches(url: string, method: string) {
    return new URL(url).origin === new URL(this.config.baseUrl).origin && method === this.config.api.method && matchesApi(url, this.config.api);
  }
  observe(url: string, method: string) {
    if (new URL(url).origin !== new URL(this.config.baseUrl).origin) return;
    if (this.matches(url, method)) this.observed = Math.min(this.observed + 1, this.limit + 1);
    for (const watch of this.watched.values()) if (method === watch.request.method && matchesApi(url, watch.request)) watch.count = Math.min(watch.count + 1, 31);
  }
  count(action: Extract<Action, { type: "waitForRequest" }>) { return this.watched.get(JSON.stringify(action.request))?.count ?? 0; }
  begin(): RequestResult {
    this.intercepted = Math.min(this.intercepted + 1, this.limit + 1);
    if (!this.firstAt) this.firstAt = Date.now();
    const record: RequestResult = { ordinal: this.intercepted, phase: this.scenario.id === "baseline" ? "baseline" : this.recovering ? "recovery" : "fault", outcome: "pending", status: null };
    if (this.records.length <= this.limit) this.records.push(record);
    if (this.intercepted > this.limit) this.issue ??= new RunnerIssue("FAIL", "REQUEST_LIMIT_EXCEEDED", `The application exceeded the configured maximum of ${this.limit} matching API requests. Further requests were blocked.`);
    if (this.scenario.id !== "baseline" && this.scenario.recovery && !this.recovering && this.intercepted > this.affected) this.issue ??= new RunnerIssue("FAIL", "REQUEST_BEFORE_RETRY", "An extra API request occurred before the configured Retry action. Recovery cannot be attributed to Retry.");
    if (this.recovering && this.intercepted > this.affected + 1) this.issue ??= new RunnerIssue("FAIL", "UNEXPECTED_RETRY_COUNT", "Retry triggered more than one additional matching request; deterministic recovery was not established.");
    return record;
  }
  armRecovery() {
    this.check();
    if (this.intercepted !== this.affected || this.faulted !== this.affected) throw new RunnerIssue("ERROR", "FAULT_COVERAGE_INCOMPLETE", "The configured fault request count was not completed before recovery.");
    this.recovering = true;
  }
  check() { if (this.issue) throw this.issue; }
  async wait(ordinal: number, timeout: number, recovery: boolean, checkHealth: () => void) {
    try {
      await expect.poll(() => { checkHealth(); return this.records[ordinal - 1]?.outcome !== undefined && this.records[ordinal - 1]?.outcome !== "pending"; }, { timeout }).toBe(true);
    } catch {
      checkHealth();
      if (recovery && this.intercepted < ordinal) throw new RunnerIssue("FAIL", "RETRY_NO_REQUEST", "Retry was clicked, but no second matching API request was observed within the request timeout.");
      if (this.intercepted < ordinal) throw new RunnerIssue("ERROR", "API_NOT_OBSERVED", "No matching API request was intercepted for the required occurrence. Check the pathname, GET method, browser-side fetching and page trigger.");
      throw new RunnerIssue("ERROR", "API_REQUEST_TIMEOUT", "The matching API request did not complete within the request budget.");
    }
    checkHealth();
    if (recovery) {
      const record = this.records[ordinal - 1]!;
      if (record.outcome !== "forwarded" || record.status === null || record.status < 200 || record.status >= 300) throw new RunnerIssue("FAIL", "RECOVERY_HTTP_STATUS", `Retry made a request, but its real response was not successful (HTTP ${record.status ?? "unavailable"}).`);
    }
  }
}
