import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { type RunResult, summarize } from "./results";
import { scenarioLabels } from "./scenarios";

const escape = (value: string) => value.replace(/[\\`*_{}[\]()<>|#!]/g, "\\$&").replace(/[\r\n]+/g, " ");
export function markdownReport(run: RunResult): string {
  const counts = summarize(run.results);
  const lines = [
    "# FaultLane report", "", `- Run: ${run.id}`, `- Application: ${escape(run.application)}`,
    `- API pathname pattern: ${escape(run.apiPattern)}`, `- Started (UTC): ${run.startedAt}`,
    `- Duration: ${(run.durationMs / 1000).toFixed(2)} s`, `- Results: ${counts.pass} PASS / ${counts.fail} FAIL / ${counts.error} ERROR`, "",
    "PASS means the configured UI assertions succeeded and the target request was intercepted. FAIL means observed behavior did not meet expectations. ERROR means the test could not be completed reliably.", "",
  ];
  for (const result of run.results) {
    lines.push(`## ${scenarioLabels[result.id]} — ${result.status}`, "", `Duration: ${result.durationMs} ms. Intercepted requests: ${result.interceptedRequests}.`, "", `**Observation:** ${escape(result.observation)}`, "", "### Expected and observed behavior", "");
    for (const assertion of result.assertions) lines.push(`- ${assertion.passed ? "PASS" : "FAIL"} (${assertion.phase}) — Expected: ${escape(assertion.expected)}. Observed: ${escape(assertion.observed)}`);
    if (result.assertions.length === 0) lines.push("- UI assertions were not reached; no UI success is claimed.");
    lines.push("", `**Suggested inspection (not a proven root cause):** ${escape(result.suggestion)}`, "");
    for (const diagnostic of result.diagnostics) lines.push(`- Diagnostic: ${escape(diagnostic)}`);
    if (result.screenshot) lines.push("", `[${result.status === "PASS" ? "Scenario" : "Failure"} screenshot](./${result.screenshot})`);
    if (result.loadingScreenshot) lines.push("", `[Loading during delay](./${result.loadingScreenshot})`);
    lines.push("");
  }
  lines.push("## Scope and privacy", "", "Fresh Chromium context per scenario. Browser GET requests only. Server-side API calls are not covered. No request bodies, cookies, authorization headers, console messages or raw exception stacks are saved. Query strings are omitted from the application URL. Screenshots contain visible page content; use synthetic data and mask private UI. Suggestions are investigation leads, not established causes.", "");
  return lines.join("\n");
}

export async function writeReport(directory: string, run: RunResult) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "report.md.tmp"), markdownReport(run), "utf8");
  await rename(path.join(directory, "report.md.tmp"), path.join(directory, "report.md"));
  // JSON is the commit marker: the dashboard lists only completed, validated runs.
  await writeFile(path.join(directory, "results.json.tmp"), JSON.stringify(run, null, 2) + "\n", "utf8");
  await rename(path.join(directory, "results.json.tmp"), path.join(directory, "results.json"));
}
