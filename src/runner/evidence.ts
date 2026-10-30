import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

// Never include filesystem paths or arbitrary browser exception text in reports.
export class EvidenceIssue extends Error {
  constructor(public readonly stage: string, public readonly reason: string) {
    super(`${stage}: ${reason}`);
  }
}

export function evidenceReason(error: unknown): string {
  if (error instanceof EvidenceIssue) return error.message;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && /^(EACCES|EPERM|ENOENT|ENOTDIR|EEXIST|ENOSPC|EMFILE|EBUSY|EIO|EROFS|EINVAL)$/.test(code) ? code : "UNKNOWN";
}

/** Publish a fully written, verified file without replacing an existing destination. */
export async function writeExclusiveFile(filename: string, data: Buffer): Promise<void> {
  const directory = path.dirname(filename);
  const temporary = path.join(directory, `.${path.basename(filename)}.${randomUUID()}.tmp`);
  let created = false;
  let stage = "directory";
  try {
    await mkdir(directory, { recursive: true });
    stage = "temporary-create";
    const file = await open(temporary, "wx", 0o600);
    created = true;
    try {
      stage = "write";
      await file.writeFile(data);
      await file.sync();
    } finally { await file.close(); }
    stage = "verify";
    if (!(await readFile(temporary)).equals(data)) throw new EvidenceIssue(stage, "CONTENT_MISMATCH");
    stage = "publish";
    // Hard-linking is atomic and refuses to overwrite, including on Windows.
    await link(temporary, filename);
  } catch (error) {
    if (error instanceof EvidenceIssue) throw error;
    throw new EvidenceIssue(stage, evidenceReason(error));
  } finally {
    if (created) await unlink(temporary).catch(() => undefined);
  }
}
