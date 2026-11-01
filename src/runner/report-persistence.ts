import { lstat, unlink } from "node:fs/promises";
import path from "node:path";
import { EVIDENCE_CLEANUP_DEADLINE_MS, EVIDENCE_IO_DEADLINE_MS, EvidenceIssue, REPORT_PENDING_FILE, evidenceReason, withEvidenceDeadline, writeExclusiveFile, type EvidenceWriteOptions } from "./evidence";
import type { SerializedReport } from "./report-serialization";

export type ReportPersistence = { status: "SAVED"; visibility: "READY" | "PENDING"; warning?: string };

export async function publishReportFiles(directory: string, names: { markdown: string; json: string }, serialized: SerializedReport, options: EvidenceWriteOptions = {}): Promise<ReportPersistence> {
  if (Buffer.byteLength(serialized.json) > 2_000_000 || Buffer.byteLength(serialized.markdown) > 2_000_000) throw new EvidenceIssue("report-serialize", "REPORT_TOO_LARGE");
  for (const filename of [names.markdown, names.json]) {
    try {
      await withEvidenceDeadline("report-preflight", () => lstat(path.join(directory, filename)), options.timeoutMs ?? EVIDENCE_IO_DEADLINE_MS);
      throw new EvidenceIssue("report-preflight", "EEXIST");
    } catch (error) {
      // Only absence permits publication. An invalid parent can fail here on
      // Linux (ENOTDIR) or later in mkdir on Windows; both are evidence errors.
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") continue;
      throw error instanceof EvidenceIssue ? error : new EvidenceIssue("report-preflight", evidenceReason(error), { cause: error });
    }
  }
  const marker = path.join(directory, REPORT_PENDING_FILE);
  await writeExclusiveFile(marker, Buffer.from("Report publication is incomplete.\n"), options);
  await writeExclusiveFile(path.join(directory, names.markdown), Buffer.from(serialized.markdown), options);
  await writeExclusiveFile(path.join(directory, names.json), Buffer.from(serialized.json), options);
  try { await withEvidenceDeadline("report-visibility", () => unlink(marker), options.cleanupMs ?? EVIDENCE_CLEANUP_DEADLINE_MS); }
  catch (error) {
    // Both files are already saved and verified. A late marker removal only
    // delays visibility; it cannot turn an unsuccessful report write into PASS.
    if (error instanceof EvidenceIssue && error.reason === "TIMEOUT") return { status: "SAVED", visibility: "PENDING", warning: "REPORT_VISIBILITY_TIMEOUT" };
    throw new EvidenceIssue("report-visibility", evidenceReason(error), { cause: error });
  }
  return { status: "SAVED", visibility: "READY" };
}
