import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FaultLaneConfig, Scenario } from "./config";
import { runResultSchema, type RunResult, type ScenarioResult } from "./results";
import { writeExclusiveFile } from "./evidence";

type Category = "REGRESSION" | "IMPROVEMENT" | "UNCHANGED" | "NEW" | "REMOVED" | "INCOMPARABLE";
type Coverage = { id: string; baseExpected: number | null; headExpected: number | null; baseActual: number | null; headActual: number | null };
export type ComparisonEntry = { id: string; category: Category; base: string | null; head: string | null; baseEvidence: string; headEvidence: string; baseScreenshot: string; headScreenshot: string; coverage: Coverage[]; reason: string };
export type Comparison = { version: 1; baseRun: string; headRun: string; entries: ComparisonEntry[]; limitations: string[] };

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
// Only a digest is stored; request values and mock bodies remain private.
export function scenarioIdentity(config: FaultLaneConfig, scenario: Scenario): string {
  const shared = Object.fromEntries(Object.entries(config).filter(([key]) => !["reportsDir", "scenarios", "baseline", "name"].includes(key)));
  return createHash("sha256").update(JSON.stringify(stable({ shared, scenario }))).digest("hex");
}

function evidence(result: ScenarioResult | undefined): string {
  if (!result) return "NOT_PRESENT";
  if (result.evidence) return result.evidence.status;
  return "NOT_RECORDED";
}
function coverage(base?: ScenarioResult, head?: ScenarioResult): Coverage[] {
  const ids = new Set([...(base?.endpoints ?? []).map((e) => e.id), ...(head?.endpoints ?? []).map((e) => e.id)]);
  return [...ids].sort().map((id) => {
    const a = base?.endpoints?.find((e) => e.id === id); const b = head?.endpoints?.find((e) => e.id === id);
    return { id, baseExpected: a?.expectedRequests ?? null, headExpected: b?.expectedRequests ?? null, baseActual: a?.interceptedRequests ?? null, headActual: b?.interceptedRequests ?? null };
  });
}
export function compareRuns(base: RunResult, head: RunResult): Comparison {
  const a = new Map(base.results.map((r) => [r.id, r])); const b = new Map(head.results.map((r) => [r.id, r]));
  if (a.size !== base.results.length || b.size !== head.results.length) throw new Error("Duplicate scenario IDs in report.");
  const entries: ComparisonEntry[] = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const before = a.get(id); const after = b.get(id);
    let category: Category; let reason = "";
    if (base.application !== head.application || base.apiPattern !== head.apiPattern) { category = "INCOMPARABLE"; reason = "Application or API scope differs between reports."; }
    else if (!before) category = "NEW";
    else if (!after) category = "REMOVED";
    else if (!before.identity || !after.identity || before.identity !== after.identity) {
      category = "INCOMPARABLE"; reason = "Scenario identity is missing or changed; matching names alone are insufficient.";
    } else if (before.status === "PASS" && after.status === "FAIL") category = "REGRESSION";
    else if ((before.status === "FAIL" || before.status === "ERROR") && after.status === "PASS") category = "IMPROVEMENT";
    else if (before.status !== after.status) { category = "INCOMPARABLE"; reason = "Execution errors cannot establish a behavioral regression."; }
    else category = "UNCHANGED";
    entries.push({ id, category, base: before?.status ?? null, head: after?.status ?? null, baseEvidence: evidence(before), headEvidence: evidence(after), baseScreenshot: "NOT_CHECKED", headScreenshot: "NOT_CHECKED", coverage: coverage(before, after), reason });
  }
  return { version: 1, baseRun: base.id, headRun: head.id, entries, limitations: ["Only identical recorded scenario identities are compared; old reports lack identity and are incomparable.", "Execution errors do not prove a behavioral regression. Evidence status describes the original run and does not prove files still exist.", "Durations are not compared. Endpoint counts are recorded only when available."] };
}
async function screenshotAvailability(result: ScenarioResult | undefined, reportFile: string): Promise<string> {
  if (!result?.screenshot) return "NOT_RECORDED";
  const file = path.join(path.dirname(reportFile), result.screenshot);
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 8 || info.size > 20_000_000) return "UNAVAILABLE";
    const handle = await open(file, "r");
    try {
      const header = Buffer.alloc(8); const read = await handle.read(header, 0, 8, 0);
      return read.bytesRead === 8 && header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? `AVAILABLE: ${result.screenshot}` : "UNAVAILABLE";
    } finally { await handle.close(); }
  } catch { return "UNAVAILABLE"; }
}
export async function inspectComparisonEvidence(comparison: Comparison, base: RunResult, head: RunResult, baseFile: string, headFile: string): Promise<void> {
  await Promise.all(comparison.entries.map(async (entry) => {
    const [before, after] = await Promise.all([screenshotAvailability(base.results.find((r) => r.id === entry.id), baseFile), screenshotAvailability(head.results.find((r) => r.id === entry.id), headFile)]);
    entry.baseScreenshot = before; entry.headScreenshot = after;
  }));
}
export async function readComparisonInput(filename: string): Promise<RunResult> {
  const size = (await stat(filename)).size;
  if (size > 2_000_000) throw new Error("Report is too large.");
  return runResultSchema.parse(JSON.parse(await readFile(filename, "utf8")) as unknown);
}
export function comparisonExitCode(comparison: Comparison): 0 | 1 | 2 {
  if (comparison.entries.some((e) => e.category === "INCOMPARABLE")) return 2;
  return comparison.entries.some((e) => e.category === "REGRESSION") ? 1 : 0;
}
export function comparisonMarkdown(comparison: Comparison): string {
  const lines = ["# FaultLane Regression Check", "", `Baseline: ${comparison.baseRun}`, `Current: ${comparison.headRun}`, "", `Scenarios analyzed: ${comparison.entries.length}`, ""];
  for (const category of ["REGRESSION", "IMPROVEMENT", "UNCHANGED", "NEW", "REMOVED", "INCOMPARABLE"] as const) {
    const items = comparison.entries.filter((e) => e.category === category);
    lines.push(`## ${category} (${items.length})`, "");
    for (const item of items) {
      lines.push(`- ${item.id}: ${item.base ?? "not present"} → ${item.head ?? "not present"}; evidence ${item.baseEvidence} → ${item.headEvidence}.${item.reason ? ` ${item.reason}` : ""}`);
      lines.push(`  - Screenshots: ${item.baseScreenshot} → ${item.headScreenshot}.`);
      for (const endpoint of item.coverage) lines.push(`  - Endpoint ${endpoint.id.replace(/[^a-zA-Z0-9_.-]/g, "_")}: expected ${endpoint.baseExpected ?? "unknown"} → ${endpoint.headExpected ?? "unknown"}; intercepted ${endpoint.baseActual ?? "unknown"} → ${endpoint.headActual ?? "unknown"}.`);
    }
    if (!items.length) lines.push("- None.");
    lines.push("");
  }
  lines.push("## Limitations", "", ...comparison.limitations.map((s) => `- ${s}`), "");
  return lines.join("\n");
}
export async function writeComparison(root: string, comparison: Comparison): Promise<string> {
  const directory = path.join(root, `comparison-${randomUUID()}`);
  await writeExclusiveFile(path.join(directory, "comparison.md"), Buffer.from(comparisonMarkdown(comparison)));
  await writeExclusiveFile(path.join(directory, "comparison.json"), Buffer.from(JSON.stringify(comparison, null, 2) + "\n"));
  return directory;
}
