import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";

export const EVIDENCE_IO_DEADLINE_MS = 10_000;
export const EVIDENCE_CLEANUP_DEADLINE_MS = 2_000;
export const SCREENSHOT_DEADLINE_MS = 5_000;
export const REPORT_PENDING_FILE = ".faultlane-report-pending";

// Never include filesystem paths or arbitrary browser exception text in reports.
export class EvidenceIssue extends Error {
  readonly code: "EVIDENCE_TIMEOUT" | "EVIDENCE_UNSUPPORTED" | "EVIDENCE_WRITE" | "REPORT_SERIALIZATION";
  constructor(public readonly stage: string, public readonly reason: string) {
    super(`${stage}: ${reason}`);
    this.code = reason.startsWith("TIMEOUT") ? "EVIDENCE_TIMEOUT" : reason.startsWith("HARDLINK_UNSUPPORTED") ? "EVIDENCE_UNSUPPORTED" : stage === "report-serialize" ? "REPORT_SERIALIZATION" : "EVIDENCE_WRITE";
  }
}

export function evidenceReason(error: unknown): string {
  if (error instanceof EvidenceIssue) return error.message;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && /^(EACCES|EPERM|ENOENT|ENOTDIR|EEXIST|ENOSPC|EMFILE|ENFILE|EBUSY|EIO|EROFS|EINVAL|EISDIR|ELOOP|ENAMETOOLONG|EFBIG|ENOTSUP|EOPNOTSUPP|ENOSYS|EXDEV)$/.test(code) ? code : "UNKNOWN";
}

/** Bounds the caller's wait; it does not claim to cancel the underlying OS operation. */
export async function withEvidenceDeadline<T>(stage: string, operation: () => Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new EvidenceIssue(stage, "TIMEOUT");
  const expiresAt = performance.now() + timeoutMs;
  const pending = Promise.resolve().then(operation);
  return await new Promise<T>((resolve, reject) => {
    let finished = false;
    const timeout = () => { if (finished) return; finished = true; clearTimeout(timer); try { onTimeout?.(); } catch { /* The deadline still rejects. */ } reject(new EvidenceIssue(stage, "TIMEOUT")); };
    const timer = setTimeout(timeout, timeoutMs);
    pending.then((value) => { if (finished) return; if (performance.now() >= expiresAt) { timeout(); return; } finished = true; clearTimeout(timer); resolve(value); }, (error: unknown) => { if (finished) return; if (performance.now() >= expiresAt) { timeout(); return; } finished = true; clearTimeout(timer); reject(error); });
  });
}

export type EvidenceWriteOptions = { timeoutMs?: number; cleanupMs?: number };
type Handle = Awaited<ReturnType<typeof open>>;

/** A pending marker quarantines reports until both files have been saved. */
export async function assertReportPublished(directory: string): Promise<void> {
  try { await withEvidenceDeadline("report-visibility", () => lstat(path.join(directory, REPORT_PENDING_FILE)), EVIDENCE_IO_DEADLINE_MS); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  throw new EvidenceIssue("report-visibility", "PENDING");
}

/** Publish verified bytes without replacing another file, even when a stage times out. */
export async function writeExclusiveFile(filename: string, data: Buffer, options: EvidenceWriteOptions = {}): Promise<void> {
  const directory = path.dirname(filename);
  const temporary = path.join(directory, `.${path.basename(filename)}.${randomUUID()}.tmp`);
  const timeoutMs = options.timeoutMs ?? EVIDENCE_IO_DEADLINE_MS;
  const cleanupMs = options.cleanupMs ?? EVIDENCE_CLEANUP_DEADLINE_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new EvidenceIssue("directory", "TIMEOUT");
  if (!Number.isFinite(cleanupMs) || cleanupMs <= 0) throw new EvidenceIssue("cleanup", "TIMEOUT");
  const deadline = performance.now() + timeoutMs;
  const controller = new AbortController();
  let handle: Handle | undefined;
  let created = false;
  let published = false;
  let timedOutStage = "";
  let pending: Promise<unknown> = Promise.resolve();
  let stage = "directory";
  let failure: EvidenceIssue | undefined;

  const step = async <T>(name: string, action: () => Promise<T>, completed?: (value: T) => void): Promise<T> => {
    stage = name;
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) { timedOutStage = name; controller.abort(); throw new EvidenceIssue(name, "TIMEOUT"); }
    const operation = Promise.resolve().then(action).then((value) => { completed?.(value); return value; });
    pending = operation;
    return await withEvidenceDeadline(name, () => operation, remaining, () => { timedOutStage = name; controller.abort(); });
  };

  try {
    await step("directory", () => mkdir(directory, { recursive: true }));
    await step("temporary-create", () => open(temporary, "wx", 0o600), (file) => { handle = file; created = true; });
    await step("write", () => handle!.writeFile(data, { signal: controller.signal }));
    await step("flush", () => handle!.sync());
    await step("close", () => handle!.close(), () => { handle = undefined; });
    const contents = await step("verify", () => readFile(temporary, { signal: controller.signal }));
    if (!contents.equals(data)) throw new EvidenceIssue("verify", "CONTENT_MISMATCH");
    await step("publish", () => link(temporary, filename), () => { published = true; });
  } catch (error) {
    const reason = evidenceReason(error);
    if (stage === "publish" && /^(ENOTSUP|EOPNOTSUPP|ENOSYS|EXDEV)$/.test(reason)) failure = new EvidenceIssue(stage, `HARDLINK_UNSUPPORTED (${reason})`);
    else failure = error instanceof EvidenceIssue ? error : new EvidenceIssue(stage, reason);
  }

  // The last operation may still be in flight after timeout. Do not close its handle
  // or remove its temporary file until it settles. No subsequent publish is started.
  const cleanup = pending.catch(() => undefined).then(async () => {
    const failures: string[] = [];
    if (handle) {
      try { await handle.close(); } catch (error) { failures.push(`close ${evidenceReason(error)}`); }
      handle = undefined;
    }
    if (created && published && timedOutStage === "publish") {
      try {
        const [source, target] = await Promise.all([stat(temporary), lstat(filename)]);
        // Never remove a file unless it is still the same inode we published.
        if (source.ino !== 0 && source.ino === target.ino && source.dev === target.dev && target.isFile()) await unlink(filename);
        else failures.push("ownership unverified");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") failures.push(`published-file ${evidenceReason(error)}`); }
    }
    if (created) {
      try { await unlink(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") failures.push(`temporary ${evidenceReason(error)}`); }
    }
    if (failures.length) throw new EvidenceIssue("cleanup", failures.join(", "));
  });
  try { await withEvidenceDeadline("cleanup", () => cleanup, cleanupMs); }
  catch (error) {
    const reason = `${error instanceof EvidenceIssue ? `[${error.code}] ` : ""}${evidenceReason(error)}`;
    failure = failure ? new EvidenceIssue(failure.stage, `${failure.reason}; ${reason}`) : error instanceof EvidenceIssue ? error : new EvidenceIssue("cleanup", reason);
  }
  if (failure) throw failure;
}
