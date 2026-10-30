import { type RunResult, type ScenarioResult, summarize } from "./results";
import { scenarioLabels } from "./scenarios";
import type { EvidenceWriteOptions } from "./evidence";
import { serializeReport } from "./report-serialization";
import { publishReportFiles, type ReportPersistence } from "./report-persistence";
export type { ReportPersistence } from "./report-persistence";

const escape = (value: string) => value.replace(/[\\`*_{}[\]()<>|#!]/g, "\\$&").replace(/[\r\n]+/g, " ");
function endpointEvidence(result: ScenarioResult): string[] {
  if (!result.endpoints || !result.network) return [];
  const network = result.network;
  const lines = ["", "### Endpoint coverage", "", "Query values, headers and response bodies are omitted. Request ordinals are independent for each endpoint.", ""];
  for (const endpoint of result.endpoints) {
    lines.push(`#### ${escape(endpoint.id)} — ${escape(endpoint.method)} ${escape(endpoint.origin)}${escape(endpoint.pathname)}`, "",
      `Query keys (all values redacted): ${endpoint.queryKeys.length ? endpoint.queryKeys.map(escape).join(", ") : "none"}.`,
      `Expected requests: ${endpoint.expectedRequests}; limit: ${endpoint.maxRequests}. Observed: ${endpoint.observedRequests}; intercepted: ${endpoint.interceptedRequests}; blocked: ${endpoint.blockedRequests}; faulted: ${endpoint.faultedRequests}.`, "",
      "Expected response sequence:", "");
    for (const response of endpoint.expectedSequence) lines.push(`- #${response.ordinal}: ${escape(response.action)}, HTTP ${response.status ?? "not applicable"}${response.delayMs === undefined ? "" : `; configured delay ${response.delayMs} ms`}.`);
    lines.push("", "Actual response sequence:", "");
    for (const response of endpoint.requests) lines.push(`- #${response.ordinal}: ${response.phase}, ${response.outcome}, HTTP ${response.status ?? "not applicable"}; injected fault: ${response.fault ? "yes" : "no"}.`);
    if (!endpoint.requests.length) lines.push("- No matching request was intercepted; no endpoint coverage is claimed.");
    lines.push("");
  }
  lines.push("### Browser network policy and evidence", "", `Policy: ${network.policy}. Browser requests observed: ${network.observedRequests}; blocked: ${network.blockedRequests}; explicitly allowed: ${network.allowedRequests}; mocked: ${network.mockedRequests}.`,
    "An origin declared for mocking does not grant permission to contact that API. Forwarded responses and allowed asset requests are distinct from mocked responses.",
    `Routes with zero matches: ${network.zeroMatchTargets.length ? network.zeroMatchTargets.map(escape).join(", ") : "none"}.`, "",
    "| Method | Origin and path | Query keys (values redacted) | Resource | Decision | Endpoint |", "| --- | --- | --- | --- | --- | --- |");
  for (const event of network.events) lines.push(`| ${escape(event.method)} | ${escape(event.origin)}${escape(event.pathname)} | ${event.queryKeys.map(escape).join(", ") || "—"} | ${escape(event.resourceType)} | ${event.decision} | ${escape(event.endpointId ?? "—")} |`);
  if (network.truncated) lines.push("", "Only the first 200 browser network events are shown; the counters include later events.");
  lines.push("", "Coverage warnings:", "");
  for (const warning of network.warnings) lines.push(`- ${escape(warning)}`);
  if (!network.warnings.length) lines.push("- None recorded. This is not a claim of complete application network coverage.");
  lines.push("", "Hypotheses — not verified causes:", "");
  for (const hypothesis of network.hypotheses) lines.push(`- ${escape(hypothesis)}`);
  if (!network.hypotheses.length) lines.push("- None recorded.");
  lines.push("", "Recommended debugging actions:", "");
  for (const action of network.nextActions) lines.push(`- ${escape(action)}`);
  if (!network.nextActions.length) lines.push("- None recorded.");
  return lines;
}
export function markdownReport(run: RunResult): string {
  const counts = summarize(run.results);
  const lines = [
    "# FaultLane report", "", `- Name: ${escape(run.name ?? "Legacy v0.1 run")}`, `- Run: ${run.id}`, `- Application: ${escape(run.application)}`,
    `- API pathname pattern: ${escape(run.apiPattern)}`, `- Started (UTC): ${run.startedAt}`,
    `- Duration: ${(run.durationMs / 1000).toFixed(2)} s`, `- Results: ${counts.pass} PASS / ${counts.fail} FAIL / ${counts.error} ERROR`, "",
    "PASS means the configured UI assertions succeeded and the target request was intercepted. FAIL means observed behavior did not meet expectations. ERROR means the test could not be completed reliably.", "",
  ];
  for (const result of run.results) {
    lines.push(`## ${escape(result.name ?? scenarioLabels[result.id])} — ${result.status}`, "", `Duration: ${result.durationMs} ms. Observed requests: ${result.observedRequests ?? "not recorded (v0.1)"}. Intercepted requests: ${result.interceptedRequests}. Faulted requests: ${result.faultedRequests ?? "not recorded (v0.1)"}.`, "", `**Observation:** ${escape(result.observation)}`, `Code: ${result.code ?? "none"}. Failed step: ${result.failedStep ?? "none"}.`, "", "### Expected and observed behavior", "");
    for (const assertion of result.assertions) lines.push(`- ${assertion.passed ? "PASS" : "FAIL"} (${assertion.phase}) — Expected: ${escape(assertion.expected)}. Observed: ${escape(assertion.observed)}`);
    if (result.assertions.length === 0) lines.push("- UI assertions were not reached; no UI success is claimed.");
    if (result.steps) {
      lines.push("", "### Journey steps", "", `Completed: ${result.steps.filter((s) => s.status === "PASS").length}/${result.steps.length}. SKIPPED steps were not evaluated.`, "");
      for (const step of result.steps) {
        lines.push(`- ${step.index}. ${step.status} [${step.phase}] — Expected: ${escape(step.expected)}. Observed: ${escape(step.observed)} (${step.durationMs} ms)${step.code ? `; code: ${step.code}` : ""}.`);
        if (step.screenshot) lines.push(`  [Step ${step.index} evidence](./${step.screenshot})`);
      }
    }
    if (result.requests?.length) {
      lines.push("", "### API request evidence", "");
      for (const request of result.requests) lines.push(`- #${request.ordinal}: ${request.phase}, ${request.outcome}, HTTP ${request.status ?? "not applicable"}.`);
    }
    lines.push(...endpointEvidence(result));
    lines.push("", `**Suggested inspection (not a proven root cause):** ${escape(result.suggestion)}`, "");
    for (const diagnostic of result.diagnostics) lines.push(`- Diagnostic: ${escape(diagnostic)}`);
    if (result.evidence) {
      lines.push(`- Evidence: ${result.evidence.status}`);
      if (result.evidence.captureStatus || result.evidence.persistenceStatus) lines.push(`- Screenshot capture: ${result.evidence.captureStatus ?? "not recorded"}; file persistence: ${result.evidence.persistenceStatus ?? "not recorded"}.`);
      for (const failure of result.evidence.failures) lines.push(`- Evidence failure: ${escape(failure)}`);
    }
    if (result.screenshot) lines.push("", `[${result.status === "PASS" ? "Scenario" : "Failure"} screenshot](./${result.screenshot})`);
    if (result.loadingScreenshot) lines.push("", `[Loading during delay](./${result.loadingScreenshot})`);
    lines.push("");
  }
  lines.push("## Scope and privacy", "", "Fresh Chromium context per scenario. Browser HTTP fetch/XHR coverage follows the configured methods and routes. Service workers are blocked for routing visibility; this changes offline/cache behavior. Server-side API calls, WebSocket application messages and requests outside the browser context are not covered. No request bodies, response bodies, cookies, authorization headers, console messages or raw exception stacks are saved. All query values are omitted from network evidence, and query strings are omitted from the application URL. URL paths and screenshots may contain private application data; use synthetic data and mask private UI. Suggestions and hypotheses are investigation leads, not established causes.", "");
  return lines.join("\n");
}

export async function writeReport(directory: string, run: RunResult, options: EvidenceWriteOptions & { serializationMs?: number } = {}): Promise<ReportPersistence> {
  return await publishReportFiles(directory, { markdown: "report.md", json: "results.json" }, await serializeReport(run, options.serializationMs), options);
}
