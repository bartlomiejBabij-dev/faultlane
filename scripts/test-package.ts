import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { runResultSchema, type RunResult } from "../src/runner/results";
import { verifyCompatibilityPackage } from "./package-compatibility";

const exec = promisify(execFile);
const root = process.cwd();
const packageVersion = (JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { version: string }).version;
const npmCli = process.env.npm_execpath;
assert(npmCli, "Run through npm run test:package so the installed npm CLI is used.");
const temporary = await mkdtemp(path.join(os.tmpdir(), "faultlane-package-"));
const evidenceDir = path.join(root, ".package-tests");
await mkdir(evidenceDir, { recursive: true });
const commands: { cwd: string; args: string[]; code: number }[] = [];
async function npm(args: string[], cwd: string, expected = 0, env: Partial<NodeJS.ProcessEnv> = {}): Promise<string> {
  let code = 0; let output = "";
  try { const result = await exec(process.execPath, [npmCli!, ...args], { cwd, env: { ...process.env, ...env }, timeout: 180_000, maxBuffer: 2_000_000, windowsHide: true }); output = result.stdout; }
  catch (error) { const failure = error as { code?: number; stdout?: string; stderr?: string }; code = typeof failure.code === "number" ? failure.code : -1; output = (failure.stdout ?? "") + (failure.stderr ?? ""); }
  commands.push({ cwd, args, code });
  assert.equal(code, expected, `npm ${args.join(" ")} returned ${code}, expected ${expected}.\n${output.slice(-5000)}`);
  return output;
}
async function cli(project: string, args: string[], expected = 0, env: Partial<NodeJS.ProcessEnv> = {}): Promise<string> {
  // Use npm's installed executable shim, never src/runner or a hardcoded dist path.
  return npm(["exec", "--offline", "--no", "--", "faultlane", ...args], project, expected, env);
}
type Packed = { filename: string; size: number; files: { path: string }[] };
function packResult(output: string): Packed {
  // npm 11 returns an array; npm 12 returns an object keyed by package name.
  const start = Math.min(...[output.indexOf("["), output.indexOf("{")].filter((index) => index >= 0));
  const parsed = JSON.parse(output.slice(start)) as Packed[] | Record<string, Packed>;
  return Object.values(parsed)[0]!;
}
async function reportFrom(output: string): Promise<{ run: RunResult; directory: string }> {
  const directory = output.match(/Report: (.+)/)?.[1]?.trim();
  assert(directory, "CLI must print report location");
  assert(directory.startsWith(temporary + path.sep), "Reports must remain in the external project");
  const run = runResultSchema.parse(JSON.parse(await readFile(path.join(directory, "results.json"), "utf8")));
  assert((await readFile(path.join(directory, "report.md"), "utf8")).includes("# FaultLane report"));
  for (const result of run.results) if (result.screenshot) {
    assert.equal((await readFile(path.join(directory, result.screenshot))).subarray(1, 4).toString(), "PNG");
  }
  return { run, directory };
}
async function freePort(): Promise<number> {
  const server = createServer(); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve())); return address.port;
}
async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") await exec("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }).catch(() => undefined);
  else child.kill("SIGTERM");
}
const pack = packResult(await npm(["pack", "--dry-run", "--ignore-scripts", "--json"], root));
assert(pack.files.some((file) => file.path === "dist/cli.js"));
assert(pack.files.some((file) => file.path === "dist/config.d.ts"));
assert(pack.files.every((file) => !/^(src|reports|\.next|node_modules|examples)\//.test(file.path)), "Package must exclude dashboard, source and reports");
await npm(["pack", "--ignore-scripts", "--pack-destination", temporary, "--json"], root);
const tarball = path.join(temporary, pack.filename);
const nextProject = path.join(temporary, "next app");
const catalogProject = path.join(temporary, "catalog app");
await mkdir(nextProject); await mkdir(catalogProject);
// Only known synthetic fixture files; never copy a user's .env, reports or config.
for (const filename of ["app", "next.config.mjs", "package.json", "tsconfig.json"]) await cp(path.join(root, "examples/next-orders", filename), path.join(nextProject, filename), { recursive: true });
for (const filename of ["server.ts", "start.ts", "package.json"]) await cp(path.join(root, "examples/catalog", filename), path.join(catalogProject, filename));
const nextPkg = JSON.parse(await readFile(path.join(nextProject, "package.json"), "utf8")) as { dependencies: Record<string, string> };
const catalogPkg = JSON.parse(await readFile(path.join(catalogProject, "package.json"), "utf8")) as { devDependencies: Record<string, string> };
assert(nextPkg.dependencies.next); assert(catalogPkg.devDependencies.tsx);
let nextServer: ChildProcess | undefined;
let catalogServer: ChildProcess | undefined;
const evidence: { app: string; directory: string; statuses: string[] }[] = [];
try {
  for (const project of [nextProject, catalogProject]) {
    await npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--save-dev", tarball], project);
    assert((await cli(project, ["--help"])).includes("faultlane init"));
    assert.equal((await cli(project, ["--version"])).trim(), packageVersion);
    const installed = path.join(project, "node_modules/faultlane");
    assert(!(await readdir(installed)).includes("src"));
    const pkg = JSON.parse(await readFile(path.join(installed, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    assert(!pkg.dependencies.next && !pkg.dependencies.react, "Standalone CLI must not install dashboard runtime");
    // npm can normalize child exits; direct invocation below verifies exact 0/1/2 too.
    console.log(`Installed tarball and verified public CLI in ${path.basename(project)}.`);
  }
  const port = await freePort();
  nextServer = spawn(process.execPath, [path.join(nextProject, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: nextProject, stdio: "ignore", windowsHide: true });
  const nextUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (nextServer.exitCode !== null) throw new Error("Independent Next.js fixture exited before becoming ready.");
    try { const response = await fetch(`${nextUrl}/orders`, { signal: AbortSignal.timeout(2000) }); await response.body?.cancel(); if (response.ok) { ready = true; break; } } catch { /* finite startup polling */ }
    await delay(500);
  }
  assert(ready, "Independent Next.js fixture did not become ready");
  const catalogPort = await freePort();
  const catalogUrl = `http://127.0.0.1:${catalogPort}`;
  catalogServer = spawn(process.execPath, ["--import", "tsx", "start.ts"], { cwd: catalogProject, env: { ...process.env, PORT: String(catalogPort) }, stdio: "ignore", windowsHide: true });
  let catalogReady = false;
  for (let i = 0; i < 40; i++) {
    try { const response = await fetch(`${catalogUrl}/catalog`, { signal: AbortSignal.timeout(1000) }); await response.body?.cancel(); if (response.ok) { catalogReady = true; break; } } catch { /* finite startup polling */ }
    await delay(250);
  }
  assert(catalogReady, "Independent catalog fixture did not become ready");
  const fixtures = [
    { project: nextProject, url: nextUrl, page: "/orders", api: "/api/shipments", click: "Fetch shipments", success: "role:region:Dispatch results", data: "Parcel Aurora", problem: "role:alert:Shipment problem", error: "Shipments could not be retrieved.", retry: "Reconnect", loading: "role:status:Shipment progress", bug: "no-request" },
    { project: catalogProject, url: catalogUrl, page: "/catalog", api: "/api/inventory", click: "Search inventory", success: "role:region:Inventory results", data: "Cedar notebook", problem: "role:alert:Inventory problem", error: "Inventory is unavailable.", retry: "Try again", loading: "role:status:Catalog loading", bug: "fake-recovery" },
  ];
  for (const app of fixtures) {
    const init = ["init", "--yes", "--url", app.url, "--page", app.page, "--api", app.api, "--failure", "http-500", "--trigger", "click", "--click-name", app.click, "--success-locator", app.success, "--success-text", app.data, "--failure-locator", app.problem, "--failure-text", app.error, "--retry-name", app.retry, "--loading-locator", app.loading, "--recovery"];
    assert((await cli(app.project, init)).includes("Configuration created"));
    const configPath = path.join(app.project, "faultlane.config.ts");
    const original = await readFile(configPath, "utf8");
    // Validate the published declarations under strict Node ESM resolution as well
    // as the app's usual bundler resolution; no skipLibCheck hiding broken exports.
    await exec(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--ignoreConfig", "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", configPath], { cwd: app.project, timeout: 30_000, windowsHide: true });
    const beforeDoctor = await readdir(app.project);
    const diagnostic = await cli(app.project, ["doctor", "--no-color"]);
    assert(diagnostic.includes("Chromium") && diagnostic.includes("Target page") && !diagnostic.includes("ERROR"));
    assert.deepEqual(await readdir(app.project), beforeDoctor, "doctor must not create files in the project");
    const passed = await reportFrom(await cli(app.project, ["run", "--no-color"]));
    assert.deepEqual(passed.run.results.map((r) => r.status), ["PASS", "PASS"]);
    assert.deepEqual(passed.run.results[1]!.requests?.map((r) => [r.outcome, r.status]), [["simulated", 500], ["forwarded", 200]]);
    assert(passed.run.results.every((r) => r.steps?.every((s) => s.status === "PASS" && s.screenshot)));
    evidence.push({ app: path.basename(app.project), directory: passed.directory, statuses: passed.run.results.map((r) => r.status) });
    // Exact executable exit codes, independent of npm's normalization.
    const executable = path.join(app.project, "node_modules/faultlane/dist/cli.js");
    const direct = async (args: string[], expected: number, env: Partial<NodeJS.ProcessEnv> = {}) => {
      let code = 0; let output = "";
      try { output = (await exec(process.execPath, [executable, ...args], { cwd: app.project, timeout: 90_000, maxBuffer: 1_000_000, env: { ...process.env, ...env }, windowsHide: true })).stdout; }
      catch (error) { const e = error as { code?: number; stdout?: string; stderr?: string }; code = e.code ?? -1; output = (e.stdout ?? "") + (e.stderr ?? ""); }
      commands.push({ cwd: app.project, args: ["node", "<installed-cli>", ...args], code });
      assert.equal(code, expected, output); return output;
    };
    assert((await direct(init, 2)).includes("already exists"));
    assert.equal(await readFile(configPath, "utf8"), original);
    await direct([...init, "--backup"], 0);
    const backups = (await readdir(app.project)).filter((name) => name.endsWith(".bak"));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(app.project, backups[0]!), "utf8"), original);
    await direct(["init", "--yes", "--config", "incomplete.ts", "--url", app.url, "--page", app.page, "--api", app.api, "--failure", "http-500"], 2);
    assert(!(await readdir(app.project)).includes("incomplete.ts"));
    await writeFile(configPath, original.replace(JSON.stringify(app.page), JSON.stringify(`${app.page}?bug=${app.bug}`)));
    const failed = await reportFrom(await direct(["run", "--no-color"], 1));
    assert.deepEqual(failed.run.results.map((r) => r.status), ["PASS", "FAIL"]);
    assert.equal(failed.run.results[1]?.code, "RETRY_NO_REQUEST");
    evidence.push({ app: `${path.basename(app.project)} negative`, directory: failed.directory, statuses: failed.run.results.map((r) => r.status) });
    // Re-run exactly the original contract after correcting the explicit fixture defect.
    await writeFile(configPath, original);
    const rerun = await reportFrom(await cli(app.project, ["run"]));
    assert.deepEqual(rerun.run.results.map((r) => r.status), ["PASS", "PASS"]);
    await writeFile(configPath, original.replace(JSON.stringify(app.api), '"/api/never-requested"').replace('"requestMs": 10000', '"requestMs": 500'));
    const missing = await reportFrom(await direct(["run", "--scenario", "baseline"], 2));
    assert.equal(missing.run.results[0]?.code, "API_NOT_OBSERVED");
    await writeFile(configPath, original);
    const missingBrowserEnv = { PLAYWRIGHT_BROWSERS_PATH: path.join(temporary, "missing-browser") };
    assert((await direct(["doctor"], 2, missingBrowserEnv)).includes("faultlane browsers install"));
    const noBrowser = await reportFrom(await direct(["run"], 2, missingBrowserEnv));
    assert(noBrowser.run.results.every((r) => r.code === "BROWSER_LAUNCH" && r.status === "ERROR"));
    await writeFile(configPath, original.replace(JSON.stringify(app.url), '"http://127.0.0.1:1"'));
    assert((await direct(["doctor"], 2)).includes("No accessible local server"));
    await writeFile(configPath, original.replace(JSON.stringify(app.page), '"/missing-page"'));
    assert((await direct(["doctor"], 2)).includes("Page returned HTTP 404"));
    await writeFile(configPath, original);
    assert((await direct(["doctor", "--config", "absent.ts"], 2)).includes("Configuration missing"));
    // Simulate a broken dependency installation in the disposable external copy.
    // Only rename this known single file and always restore it, never user source.
    const playwrightEntry = path.resolve(app.project, "node_modules/@playwright/test/index.mjs");
    assert(playwrightEntry.startsWith(path.resolve(app.project) + path.sep));
    const unavailableEntry = playwrightEntry + ".disabled";
    await rename(playwrightEntry, unavailableEntry);
    try {
      assert((await direct(["--help"], 0)).includes("faultlane doctor"));
      assert((await direct(["doctor"], 2)).includes("runtime dependencies"));
    } finally { await rename(unavailableEntry, playwrightEntry); }
    console.log(`Verified init → doctor → run → FAIL → corrected re-run, missing interception/browser/app/page for ${path.basename(app.project)}.`);
  }
  await verifyCompatibilityPackage({ root, temporary, tarball, nextProject, nextUrl, npm, cli, commands, evidence });
  assert((await stat(tarball)).size > 0);
  await writeFile(path.join(evidenceDir, "latest.json"), JSON.stringify({ temporary, tarball, packageBytes: pack.size, files: pack.files.map((file) => file.path), evidence, commands, result: "PASS" }, null, 2));
  console.log(`Package smoke PASS. Evidence: ${path.join(evidenceDir, "latest.json")}`);
} finally {
  await stop(nextServer);
  await stop(catalogServer);
  // Preserve external project configs, reports and tarball for inspection; never remove history.
  await writeFile(path.join(evidenceDir, "last-commands.json"), JSON.stringify({ temporary, commands }, null, 2));
}
