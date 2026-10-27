import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { CliInputError } from "./cli-error";

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function resolveLocalPath(value: string, cwd: string): string {
  if (!value.trim() || /[\x00-\x1f]/.test(value) || /^(?:\\\\|\/\/|[a-z]:[^\\/])/i.test(value)) throw new CliInputError("Use a local filesystem path, not a network or drive-relative path.");
  const resolved = path.resolve(cwd, value);
  if (!path.isAbsolute(value) && !contained(path.resolve(cwd), resolved)) throw new CliInputError("Relative output paths must stay inside the current project. An absolute local reportsDir is an explicit opt-in.");
  return resolved;
}

// Reject existing symlinks/junctions in output paths, including dangling links.
// This protects normal local use, not races with a hostile local filesystem process.
export async function safeOutputPath(value: string, cwd: string): Promise<string> {
  const logical = resolveLocalPath(value, cwd);
  const canonicalCwd = await realpath(cwd);
  const resolved = contained(path.resolve(cwd), logical) ? path.resolve(canonicalCwd, path.relative(path.resolve(cwd), logical)) : logical;
  let current = resolved;
  while (true) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new CliInputError("Output paths must not traverse symlinks or junctions."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (current === canonicalCwd) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolved;
}

export async function initConfigPath(value: string, cwd: string): Promise<string> {
  const filename = await safeOutputPath(value, cwd);
  if (!contained(await realpath(cwd), filename) || !/\.(?:ts|mts)$/.test(filename)) throw new CliInputError("init writes a .ts or .mts configuration inside the current project.");
  await realpath(path.dirname(filename)); // Do not create directories during initialization.
  return filename;
}
