import path from "node:path";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { loadConfig } from "./load-config";
import { safeOutputPath } from "./paths";
import type { FaultLaneConfig } from "./config";

export type DoctorCheck = { name: string; status: "PASS" | "WARNING" | "ERROR"; message: string };
export function supportedNode(version: string): boolean {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  return (major === 22 && minor! >= 13) || major === 24 || major === 26;
}
export async function checkChromium(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  try {
    const { chromium } = await import("@playwright/test");
    checks.push({ name: "Playwright", status: "PASS", message: "Packaged Playwright module loaded." });
    try {
      const browser = await chromium.launch({ headless: true, timeout: 10_000 });
      await browser.close();
      checks.push({ name: "Chromium", status: "PASS", message: "Matching Chromium launched and closed successfully." });
    } catch {
      checks.push({ name: "Chromium", status: "ERROR", message: "Browser unavailable or cannot launch. Run: faultlane browsers install. On Linux also check Playwright OS libraries. No download was attempted." });
    }
  } catch { checks.push({ name: "Playwright", status: "ERROR", message: "Reinstall the local FaultLane tarball with its runtime dependencies; @playwright/test could not load." }); }
  return checks;
}
async function probe(url: string): Promise<number> {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
  await response.body?.cancel();
  return response.status;
}
export async function reportDirectoryCheck(directory: string, cwd: string): Promise<DoctorCheck> {
  try {
    let current = await safeOutputPath(directory, cwd);
    let missing = false;
    while (true) {
      try {
        if (!(await stat(current)).isDirectory()) throw new Error("Not a directory");
        await access(current, constants.W_OK);
        return { name: "Reports directory", status: missing ? "WARNING" : "PASS", message: missing ? "Directory does not exist; run will create it. Existing ancestor passes the permission check. No files written." : "Directory passes the write-permission check. Actual file creation is verified by run, not by doctor." };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = path.dirname(current);
        if (parent === current) throw error;
        missing = true; current = parent;
      }
    }
  } catch { return { name: "Reports directory", status: "ERROR", message: "Choose a writable local reportsDir. Relative paths must stay in the project; network paths and symlinks/junctions are rejected." }; }
}
export async function diagnose(filename = "faultlane.config.ts", cwd = process.cwd()): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [{ name: "Node.js", status: supportedNode(process.versions.node) ? "PASS" : "ERROR", message: supportedNode(process.versions.node) ? `Supported Node.js ${process.versions.node}.` : "Use Node.js 22.13+, 24.x or 26.x (even release lines)." }];
  checks.push(...await checkChromium());
  let config: FaultLaneConfig;
  try {
    if (!(await stat(path.resolve(cwd, filename))).isFile()) throw new Error("Not a file");
    checks.push({ name: "Configuration file", status: "PASS", message: "Local configuration found. Only trusted executable configs should be loaded." });
  } catch {
    checks.push({ name: "Configuration file", status: "ERROR", message: "Configuration missing or unreadable. Run faultlane init or select --config FILE." });
    return checks;
  }
  try {
    config = await loadConfig(filename, cwd);
    checks.push({ name: "Configuration schema", status: "PASS", message: "v0.2-compatible schema and positive UI expectations validated." });
  } catch {
    checks.push({ name: "Configuration schema", status: "ERROR", message: "Check the trusted TypeScript default export, loopback URL, steps and positive assertions. No target was contacted." });
    return checks;
  }
  checks.push({ name: "Endpoint pattern", status: "PASS", message: "GET pathname pattern valid. Actual interception must be established by run; doctor does not call the API." });
  try {
    const status = await probe(config.baseUrl);
    checks.push({ name: "Local application", status: status >= 300 ? "WARNING" : "PASS", message: `Loopback server responded HTTP ${status} at its origin. Root responses do not prove the test page works.` });
  } catch { checks.push({ name: "Local application", status: "ERROR", message: "No accessible local server within 5 seconds. Start your application and check its port and TLS certificate." }); }
  try {
    const status = await probe(new URL(config.pagePath, config.baseUrl).href);
    checks.push({ name: "Target page", status: status >= 200 && status < 300 ? "PASS" : "ERROR", message: status >= 200 && status < 300 ? "Configured page returned HTTP 2xx. UI and browser fetching are checked by run." : `Page returned HTTP ${status}. Use the final local URL; redirects are not followed.` });
  } catch { checks.push({ name: "Target page", status: "ERROR", message: "Configured page could not be reached within 5 seconds. Check pagePath and start the app." }); }
  checks.push(await reportDirectoryCheck(config.reportsDir, cwd));
  return checks;
}
