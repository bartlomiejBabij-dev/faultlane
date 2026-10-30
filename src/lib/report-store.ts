import { open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { evidencePattern, runIdPattern, runResultSchema, type RunResult } from "../runner/results";
import { assertReportPublished } from "../runner/evidence";

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function readReportFile(root: string, runId: string, filename: string): Promise<Buffer> {
  if (!runIdPattern.test(runId) || !(filename === "results.json" || filename === "report.md" || evidencePattern.test(filename))) throw new Error("Invalid report path");
  const canonicalRoot = await realpath(path.resolve(root));
  const canonicalRun = await realpath(path.join(canonicalRoot, runId));
  if (!inside(canonicalRoot, canonicalRun)) throw new Error("Report path escapes its directory");
  await assertReportPublished(canonicalRun);
  const candidate = await realpath(path.join(canonicalRun, filename));
  if (!inside(canonicalRun, candidate)) throw new Error("Report path escapes its directory");
  const file = await open(candidate, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > (filename.endsWith(".png") ? 20_000_000 : 2_000_000)) throw new Error("Unsupported report file");
    return await file.readFile();
  } finally { await file.close(); }
}

export async function listReports(root: string): Promise<{ runs: RunResult[]; skipped: number; unavailable: boolean }> {
  let entries;
  try { entries = await readdir(path.resolve(root), { withFileTypes: true }); }
  catch (error) {
    return { runs: [], skipped: 0, unavailable: (error as NodeJS.ErrnoException).code !== "ENOENT" };
  }
  const ids = entries.filter((entry) => entry.isDirectory() && runIdPattern.test(entry.name)).map((entry) => entry.name).sort().reverse().slice(0, 100);
  const runs: RunResult[] = [];
  let skipped = 0;
  for (const id of ids) {
    try {
      const data: unknown = JSON.parse((await readReportFile(root, id, "results.json")).toString("utf8"));
      const run = runResultSchema.parse(data);
      if (run.id !== id) throw new Error("Run ID mismatch");
      runs.push(run);
    } catch { skipped++; }
  }
  return { runs, skipped, unavailable: false };
}
