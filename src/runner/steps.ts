import type { Page } from "@playwright/test";
import type { FaultLaneConfig } from "./config";
import type { ScenarioResult, StepResult } from "./results";
import { RunnerIssue } from "./errors";
import path from "node:path";
import { EvidenceIssue, evidenceReason, writeExclusiveFile } from "./evidence";

export type PlannedStep = { phase: StepResult["phase"]; expected: string; run: () => Promise<void> };
export async function captureEvidence(page: Page, filename: string, config: FaultLaneConfig) {
  let data: Buffer;
  try {
    data = await page.screenshot({ fullPage: true, timeout: 5000, animations: "disabled", mask: [page.locator('input[type="password"], [data-faultlane-private]'), ...config.maskTestIds.map((id) => page.getByTestId(id))] });
  } catch (error) {
    throw new EvidenceIssue("capture", page.isClosed() ? "PAGE_CLOSED" : error instanceof Error && error.name === "TimeoutError" ? "TIMEOUT" : "BROWSER_FAILURE");
  }
  if (data.length < 8 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new EvidenceIssue("capture", "INVALID_PNG");
  await writeExclusiveFile(filename, data);
}

export function evidenceSaved(result: ScenarioResult): void {
  result.evidence ??= { status: "SKIPPED", failures: [] };
  if (result.evidence.status !== "FAILED") result.evidence.status = "SAVED";
}
export function evidenceFailed(result: ScenarioResult, where: string, error: unknown): void {
  result.evidence ??= { status: "SKIPPED", failures: [] };
  result.evidence.status = "FAILED";
  if (result.evidence.failures.length < 20) result.evidence.failures.push(`${where}: ${evidenceReason(error)}`);
}

export async function executeSteps(plan: PlannedStep[], page: Page, config: FaultLaneConfig, result: ScenarioResult, directory: string, checkHealth: () => void) {
  result.steps = plan.map((step, i) => ({ index: i + 1, phase: step.phase, expected: step.expected, observed: "Not executed because an earlier step did not complete.", status: "SKIPPED", durationMs: 0, screenshot: null, code: null }));
  for (const [i, step] of plan.entries()) {
    const entry = result.steps[i]!;
    const started = Date.now();
    let failure: RunnerIssue | undefined;
    try {
      checkHealth();
      await step.run();
      checkHealth();
      entry.status = "PASS";
      entry.observed = `Verified: ${step.expected}.`;
    } catch (error) {
      try { checkHealth(); } catch (healthError) { error = healthError; }
      failure = error instanceof RunnerIssue ? error : new RunnerIssue("ERROR", "BROWSER_EXECUTION", "Browser operation failed or the page closed; this step could not be verified.");
      entry.status = failure.status;
      entry.code = failure.code;
      entry.observed = failure.message;
    }
    if (!page.isClosed()) {
      const filename = `${result.id}-step-${String(i + 1).padStart(3, "0")}.png`;
      try { await captureEvidence(page, path.join(directory, filename), config); entry.screenshot = filename; evidenceSaved(result); }
      catch (error) {
        evidenceFailed(result, `step ${i + 1}`, error);
        if (result.diagnostics.length < 10) result.diagnostics.push(`Evidence unavailable for step ${i + 1}: ${evidenceReason(error)}.`);
        if (!failure) {
          failure = new RunnerIssue("ERROR", "EVIDENCE_WRITE", "Step completed, but required screenshot evidence could not be saved.");
          entry.status = failure.status; entry.code = failure.code; entry.observed = failure.message;
        }
      }
    } else evidenceFailed(result, `step ${i + 1}`, new EvidenceIssue("capture", "PAGE_CLOSED"));
    if (!failure) {
      try { checkHealth(); }
      catch (error) {
        failure = error instanceof RunnerIssue ? error : new RunnerIssue("ERROR", "BROWSER_EXECUTION", "Execution could not be verified after evidence capture.");
        entry.status = failure.status; entry.code = failure.code; entry.observed = failure.message;
      }
    }
    entry.durationMs = Date.now() - started;
    if (failure) { result.failedStep = entry.index; throw failure; }
  }
}
