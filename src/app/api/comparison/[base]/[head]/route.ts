import config from "../../../../../../faultlane.config";
import { readReportFile } from "@/lib/report-store";
import path from "node:path";
import { compareRuns, comparisonMarkdown, inspectComparisonEvidence } from "@/runner/compare";
import { runResultSchema } from "@/runner/results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ base: string; head: string }> }) {
  try {
    const { base, head } = await params;
    const [before, after] = await Promise.all([readReportFile(config.reportsDir, base, "results.json"), readReportFile(config.reportsDir, head, "results.json")]);
    const baseRun = runResultSchema.parse(JSON.parse(before.toString("utf8"))); const headRun = runResultSchema.parse(JSON.parse(after.toString("utf8")));
    if (baseRun.id !== base || headRun.id !== head) throw new Error("Report ID mismatch");
    const comparison = compareRuns(baseRun, headRun);
    await inspectComparisonEvidence(comparison, baseRun, headRun, path.join(config.reportsDir, base, "results.json"), path.join(config.reportsDir, head, "results.json"));
    return new Response(comparisonMarkdown(comparison), { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": "attachment; filename=\"comparison.md\"", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch { return Response.json({ error: "Comparison reports unavailable or invalid" }, { status: 404 }); }
}
