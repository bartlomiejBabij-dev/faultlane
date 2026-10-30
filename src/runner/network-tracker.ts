import type { EndpointDefinition, SequenceResponse, TargetOverride } from "./endpoint-schema";
import type { EndpointRequestResult, EndpointResult } from "./results";
import { findMatchingEndpoint } from "./network-policy";
import { RunnerIssue } from "./errors";
import { sanitizePathname, sanitizeQueryKeys } from "./network-redaction";

export type EndpointState = {
  endpoint: EndpointDefinition;
  expectedRequests: number;
  sequence: SequenceResponse[];
  sequenced: boolean;
  records: EndpointRequestResult[];
  firstAt: number;
  startedAt: Map<number, number>;
  observedRequests: number;
  interceptedRequests: number;
  blockedRequests: number;
  faultedRequests: number;
};

export function isFaultResponse(response: SequenceResponse): boolean {
  return !["mock", "forward"].includes(response.type);
}

function expectedResponse(response: SequenceResponse, ordinal: number): EndpointResult["expectedSequence"][number] {
  const inner = response.type === "slow" ? response.response : response;
  const status = inner.type === "mock" ? inner.status : inner.type === "http-500" ? 500 : inner.type === "http-429" ? 429 : inner.type === "empty" ? 200 : null;
  return { ordinal, action: response.type === "slow" ? `slow:${inner.type}` : response.type, status, ...(response.type === "slow" ? { delayMs: response.delayMs } : {}) };
}

export class NetworkTracker {
  readonly states = new Map<string, EndpointState>();
  issue?: RunnerIssue;
  private recovering = false;

  constructor(private readonly endpoints: EndpointDefinition[], private readonly baseUrl: string, targets: TargetOverride[] = [], private readonly phase: "fault" | "baseline" = "fault") {
    for (const endpoint of endpoints) {
      const target = targets.find((item) => item.id === endpoint.id);
      const expectedRequests = target?.expectedRequests ?? endpoint.expectedRequests;
      this.states.set(endpoint.id, { endpoint, expectedRequests, sequence: target?.sequence ?? Array.from({ length: expectedRequests }, () => endpoint.response), sequenced: target !== undefined, records: [], firstAt: 0, startedAt: new Map(), observedRequests: 0, interceptedRequests: 0, blockedRequests: 0, faultedRequests: 0 });
    }
  }

  match(url: string, method: string): EndpointDefinition | undefined { return findMatchingEndpoint(url, method, this.endpoints, this.baseUrl); }
  observe(url: string, method: string): void {
    const endpoint = this.match(url, method);
    if (!endpoint) return;
    const state = this.states.get(endpoint.id)!;
    state.observedRequests++;
  }

  begin(id: string): { record: EndpointRequestResult; response: SequenceResponse } | undefined {
    const state = this.states.get(id);
    if (!state) throw new Error("Unknown endpoint ID");
    state.interceptedRequests++;
    if (!state.firstAt) state.firstAt = Date.now();
    const ordinal = state.interceptedRequests;
    const response = state.sequence[ordinal - 1] ?? (state.sequenced ? undefined : state.endpoint.response);
    const priorFault = state.sequence.slice(0, ordinal - 1).some(isFaultResponse);
    const record: EndpointRequestResult = { ordinal, phase: this.phase === "baseline" ? "baseline" : this.recovering || (priorFault && response && !isFaultResponse(response)) ? "recovery" : "fault", outcome: "pending", status: null, fault: response ? isFaultResponse(response) : false };
    if (state.records.length <= state.endpoint.maxRequests) { state.records.push(record); state.startedAt.set(ordinal, Date.now()); }
    if (ordinal > state.endpoint.maxRequests || !response) {
      record.outcome = "blocked";
      state.blockedRequests++;
      this.issue ??= new RunnerIssue("FAIL", !response ? "RESPONSE_SEQUENCE_EXHAUSTED" : "REQUEST_LIMIT_EXCEEDED", !response ? `Endpoint ${id} received a request after its bounded response sequence ended.` : `Endpoint ${id} exceeded its configured request limit; further requests were blocked.`);
      return undefined;
    }
    return { record, response };
  }

  complete(id: string, record: EndpointRequestResult, outcome: EndpointRequestResult["outcome"], status: number | null): void {
    const state = this.states.get(id);
    if (!state || !state.records.includes(record) || record.outcome !== "pending") return;
    record.outcome = outcome;
    record.status = status;
    if (outcome === "blocked") state.blockedRequests++;
    const response = state.sequence[record.ordinal - 1];
    const executedFault = response?.type === "slow" ? ["simulated", "mocked", "forwarded"].includes(outcome)
      : response?.type === "network" ? outcome === "aborted"
      : record.fault && outcome === "simulated" && status === expectedResponse(response!, record.ordinal).status;
    if (executedFault) state.faultedRequests++;
  }

  armRecovery(): void { this.recovering = true; }
  check(): void { if (this.issue) throw this.issue; }
  ready(): boolean {
    return [...this.states.values()].every((state) => state.records.length >= state.expectedRequests && state.records.slice(0, state.expectedRequests).every((record) => record.outcome !== "pending"));
  }

  validateCoverage(): void {
    this.check();
    for (const [id, state] of this.states) {
      if (state.interceptedRequests === 0) throw new RunnerIssue("ERROR", "API_NOT_OBSERVED", `Endpoint ${id} had zero intercepted requests. Check the configured origin, method, path, query conditions and browser-side trigger.`);
      if (state.interceptedRequests < state.expectedRequests) throw new RunnerIssue("FAIL", "RESPONSE_SEQUENCE_INCOMPLETE", `Endpoint ${id} completed fewer requests than explicitly required; recovery or response sequence coverage was not established.`);
      if (state.interceptedRequests > state.expectedRequests || state.observedRequests !== state.interceptedRequests) throw new RunnerIssue("FAIL", "ENDPOINT_REQUEST_COUNT", `Endpoint ${id} observed and intercepted counts did not match its exact expected request count.`);
      if (state.records.some((record) => record.outcome === "pending")) throw new RunnerIssue("ERROR", "API_REQUEST_TIMEOUT", `Endpoint ${id} has a request that did not finish within the request budget.`);
      if (state.records.some((record) => ["error", "blocked"].includes(record.outcome))) throw new RunnerIssue("ERROR", "ENDPOINT_EXECUTION", `Endpoint ${id} could not complete its configured response safely.`);
      const requiredFaults = state.sequence.filter(isFaultResponse).length;
      if (state.faultedRequests !== requiredFaults) throw new RunnerIssue("ERROR", "FAULT_COVERAGE_INCOMPLETE", `Endpoint ${id} did not complete every configured fault injection.`);
      if (state.records.some((record) => record.phase === "recovery" && record.outcome === "forwarded" && (record.status === null || record.status < 200 || record.status >= 300))) throw new RunnerIssue("FAIL", "RECOVERY_HTTP_STATUS", `Endpoint ${id} recovery request did not receive a real successful HTTP response.`);
    }
  }

  summary(): EndpointResult[] {
    return [...this.states.values()].map((state) => ({ id: state.endpoint.id, origin: state.endpoint.match.origin ?? new URL(this.baseUrl).origin, method: state.endpoint.match.method, pathname: sanitizePathname(state.endpoint.match.pathname), queryKeys: sanitizeQueryKeys(Object.keys(state.endpoint.match.query ?? {})), expectedRequests: state.expectedRequests, maxRequests: state.endpoint.maxRequests, observedRequests: state.observedRequests, interceptedRequests: state.interceptedRequests, blockedRequests: state.blockedRequests, faultedRequests: state.faultedRequests, expectedSequence: state.sequence.map((response, index) => expectedResponse(response, index + 1)), requests: state.records }));
  }
}
