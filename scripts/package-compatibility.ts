import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import type { Assertion, FaultLaneConfigInput } from "../src/runner/config";
import { runResultSchema, type RunResult } from "../src/runner/results";
import { startTestApi } from "../examples/test-api/server";

const exec = promisify(execFile);
type Command = { cwd: string; args: string[]; code: number };
type Evidence = { app: string; directory: string; statuses: string[] };
type PackageContext = {
  root: string; temporary: string; tarball: string; nextProject: string; nextUrl: string;
  npm: (args: string[], cwd: string) => Promise<string>;
  cli: (project: string, args: string[]) => Promise<string>;
  commands: Command[]; evidence: Evidence[];
};

const regionText = (name: string, text: string): Assertion => ({ locator: { by: "role", role: "region", name }, state: "text", text });
const nextHealthy: Assertion[] = [regionText("Workspace projects", "Signal harbor"), regionText("Workspace identity", "Harbor operator"), regionText("Workspace notifications", "3 unread notices")];

export function nextWorkspaceConfig(baseUrl: string): FaultLaneConfigInput {
  return {
    name: "External installed Next multi-endpoint", baseUrl, pagePath: "/workspace",
    endpoints: [
      { id: "projects", match: { pathname: "/api/projects", query: { view: "active" } }, response: { type: "forward" }, maxRequests: 2 },
      { id: "profile", match: { pathname: "/api/profile" }, response: { type: "forward" }, maxRequests: 1 },
      { id: "notifications", match: { pathname: "/api/notifications" }, response: { type: "forward" }, maxRequests: 1 },
    ], actions: [{ type: "click", locator: { by: "role", role: "button", name: "Open workspace" } }],
    baseline: { assertions: nextHealthy },
    scenarios: [{ id: "http-500", targets: [{ id: "projects", sequence: [{ type: "http-500" }, { type: "forward" }], expectedRequests: 2 }],
      assertions: [{ locator: { by: "role", role: "alert", name: "Project warning" }, state: "text", text: "Project list is unavailable." }, regionText("Workspace identity", "Harbor operator"), regionText("Workspace notifications", "3 unread notices")],
      sequenceRecovery: { actions: [{ type: "click", locator: { by: "role", role: "button", name: "Retry projects" } }], assertions: nextHealthy } }],
    timeouts: { navigationMs: 30_000, requestMs: 3000, assertionMs: 2500, scenarioMs: 60_000 }, reportsDir: "reports",
  };
}

async function readReport(output: string, project: string): Promise<{ run: RunResult; directory: string }> {
  const directory = output.match(/Report: (.+)/)?.[1]?.trim();
  assert(directory, "Installed CLI must print its report directory.");
  assert(directory.startsWith(project + path.sep), "Advanced reports must be inside the external application.");
  const run = runResultSchema.parse(JSON.parse(await readFile(path.join(directory, "results.json"), "utf8")));
  assert.equal(run.schemaVersion, 3);
  for (const result of run.results) {
    assert(result.endpoints?.length); assert(result.network);
    assert(result.screenshot);
    assert.equal((await readFile(path.join(directory, result.screenshot))).subarray(1, 4).toString(), "PNG");
  }
  assert((await readFile(path.join(directory, "report.md"), "utf8")).includes("projects") || project.includes("react"));
  return { run, directory };
}

export async function verifyCompatibilityPackage(context: PackageContext): Promise<void> {
  const { root, temporary, tarball, nextProject, nextUrl, npm, cli, commands, evidence } = context;
  const direct = async (project: string, args: string[], expected: number): Promise<string> => {
    let code = 0; let output = "";
    try { output = (await exec(process.execPath, [path.join(project, "node_modules/faultlane/dist/cli.js"), ...args], { cwd: project, windowsHide: true, timeout: 120_000, maxBuffer: 1_000_000 })).stdout; }
    catch (error) { const failure = error as { code?: number; stdout?: string; stderr?: string }; code = failure.code ?? -1; output = (failure.stdout ?? "") + (failure.stderr ?? ""); }
    commands.push({ cwd: project, args: ["node", "<installed-cli>", ...args], code });
    assert.equal(code, expected, output); return output;
  };
  const save = async (project: string, config: FaultLaneConfigInput) => {
    const filename = path.join(project, "compatibility.config.ts");
    await writeFile(filename, `import type { FaultLaneConfigInput } from "faultlane/config";\nexport default ${JSON.stringify(config, null, 2)} satisfies FaultLaneConfigInput;\n`);
    return filename;
  };
  const initialize = async (project: string, config: FaultLaneConfigInput) => {
    await writeFile(path.join(project, "compatibility.input.json"), JSON.stringify(config, null, 2));
    const output = await cli(project, ["init", "--advanced", "--yes", "--from-json", "compatibility.input.json", "--config", "compatibility.config.ts", "--no-color"]);
    assert(output.includes("Configuration created"), output);
    return path.join(project, "compatibility.config.ts");
  };
  const nextConfig = nextWorkspaceConfig(nextUrl);
  const nextConfigFile = await initialize(nextProject, nextConfig);
  await exec(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--ignoreConfig", "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", nextConfigFile], { cwd: nextProject, windowsHide: true, timeout: 30_000 });
  assert(!(await cli(nextProject, ["doctor", "--config", "compatibility.config.ts", "--no-color"])).includes("ERROR"));
  const nextPass = await readReport(await cli(nextProject, ["run", "--config", "compatibility.config.ts", "--no-color"]), nextProject);
  assert.deepEqual(nextPass.run.results.map((result) => result.status), ["PASS", "PASS"]);
  const projectEndpoint = nextPass.run.results[1]!.endpoints!.find((endpoint) => endpoint.id === "projects")!;
  assert.deepEqual(projectEndpoint.requests.map((request) => [request.outcome, request.status]), [["simulated", 500], ["forwarded", 200]]);
  for (const id of ["profile", "notifications"]) assert.equal(nextPass.run.results[1]!.endpoints!.find((endpoint) => endpoint.id === id)?.interceptedRequests, 1);
  evidence.push({ app: "next multi-endpoint installed", directory: nextPass.directory, statuses: nextPass.run.results.map((result) => result.status) });
  await save(nextProject, { ...nextConfig, pagePath: "/workspace?bug=no-request" });
  const nextFail = await readReport(await direct(nextProject, ["run", "--config", "compatibility.config.ts", "--no-color"], 1), nextProject);
  assert.deepEqual(nextFail.run.results.map((result) => result.status), ["PASS", "FAIL"]);
  assert.equal(nextFail.run.results[1]?.code, "RECOVERY_REQUEST_MISSING");
  evidence.push({ app: "next multi-endpoint negative", directory: nextFail.directory, statuses: nextFail.run.results.map((result) => result.status) });
  await save(nextProject, nextConfig);
  const missingConfig = structuredClone(nextConfig); missingConfig.endpoints![0]!.match.pathname = "/api/never-requested";
  await save(nextProject, missingConfig);
  const missing = await readReport(await direct(nextProject, ["run", "--config", "compatibility.config.ts", "--scenario", "baseline", "--no-color"], 2), nextProject);
  assert.equal(missing.run.results[0]?.code, "API_NOT_OBSERVED");
  assert.deepEqual(missing.run.results[0]?.network?.zeroMatchTargets, ["projects"]);
  await save(nextProject, nextConfig);
  console.log("Verified installed CLI on independent Next multi-endpoint PASS / genuine recovery FAIL / missing-interception ERROR.");

  const reactProject = path.join(temporary, "react app"); await mkdir(reactProject);
  for (const filename of ["index.html", "package.json", "tsconfig.json", "src"]) await cp(path.join(root, "examples/react-board", filename), path.join(reactProject, filename), { recursive: true });
  await npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--save-dev", tarball], reactProject);
  assert((await cli(reactProject, ["--help"])).includes("faultlane run"));
  const portServer = createServer(); await new Promise<void>((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const address = portServer.address(); assert(address && typeof address !== "string");
  const port = address.port; await new Promise<void>((resolve) => portServer.close(() => resolve()));
  let vite: ChildProcess | undefined;
  const api = await startTestApi();
  try {
    vite = spawn(process.execPath, [path.join(reactProject, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: reactProject, windowsHide: true, stdio: "ignore" });
    const baseUrl = `http://127.0.0.1:${port}`; let ready = false;
    for (let index = 0; index < 80; index++) {
      if (vite.exitCode !== null) throw new Error("External Vite fixture exited before readiness.");
      try { const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1000) }); await response.body?.cancel(); if (response.ok) { ready = true; break; } } catch { /* ograniczony lokalny startup */ }
      await delay(250);
    }
    assert(ready, "External Vite fixture did not become ready.");
    const cards = { cards: [{ id: 11, caption: "Prepare garden map" }] };
    const healthy: Assertion[] = [regionText("Garden cards", "Prepare garden map"), { locator: { by: "label", value: "Board account" }, state: "text", text: "Garden team" }];
    const config: FaultLaneConfigInput = {
      name: "External installed Vite cross-origin", baseUrl, pagePath: `/?api=${encodeURIComponent(api.url)}`, network: { mockOrigins: [api.url] },
      endpoints: [
        { id: "cards", match: { origin: api.url, pathname: "/v2/cards", query: { lane: "ready" } }, response: { type: "mock", json: cards }, maxRequests: 3 },
        { id: "session", match: { origin: api.url, pathname: "/v2/session" }, response: { type: "mock", json: { displayName: "Garden team" } }, maxRequests: 1 },
      ], actions: [{ type: "click", locator: { by: "role", role: "button", name: "Open board" } }], baseline: { assertions: healthy },
      scenarios: [{ id: "http-500", targets: [{ id: "cards", sequence: [{ type: "http-500" }, { type: "mock", json: cards }], expectedRequests: 2 }], assertions: [{ locator: { by: "role", role: "alert", name: "Board problem" }, state: "text", text: "The board could not be loaded." }], sequenceRecovery: { actions: [{ type: "click", locator: { by: "role", role: "button", name: "Reload cards" } }], assertions: healthy } }],
      reportsDir: "reports", timeouts: { navigationMs: 25_000, requestMs: 3000, assertionMs: 2000, scenarioMs: 60_000 },
    };
    await initialize(reactProject, config);
    assert(!(await cli(reactProject, ["doctor", "--config", "compatibility.config.ts", "--no-color"])).includes("ERROR"));
    const passed = await readReport(await cli(reactProject, ["run", "--config", "compatibility.config.ts", "--no-color"]), reactProject);
    assert.deepEqual(passed.run.results.map((result) => result.status), ["PASS", "PASS"]);
    assert.equal(api.requests.length, 0, "Cross-origin mocks must never contact their real local fixture API.");
    assert(passed.run.results[1]?.endpoints?.find((endpoint) => endpoint.id === "cards")?.requests.every((request) => request.outcome !== "forwarded"));
    evidence.push({ app: "react cross-origin installed", directory: passed.directory, statuses: passed.run.results.map((result) => result.status) });
    await save(reactProject, { ...config, pagePath: `${config.pagePath}&bug=ignore-error` });
    const failed = await readReport(await direct(reactProject, ["run", "--config", "compatibility.config.ts", "--no-color"], 1), reactProject);
    assert.deepEqual(failed.run.results.map((result) => result.status), ["PASS", "FAIL"]);
    assert.equal(failed.run.results[1]?.code, "ASSERTION_FAILED");
    evidence.push({ app: "react cross-origin negative", directory: failed.directory, statuses: failed.run.results.map((result) => result.status) });
    await save(reactProject, { ...config, pagePath: `${config.pagePath}&dependency=unknown` });
    const blocked = await readReport(await direct(reactProject, ["run", "--config", "compatibility.config.ts", "--scenario", "baseline", "--no-color"], 2), reactProject);
    assert.equal(blocked.run.results[0]?.code, "NETWORK_POLICY_BLOCKED");
    assert.equal(api.requests.length, 0);
    await save(reactProject, config);
    console.log("Verified installed CLI on independent React/Vite cross-origin PASS / real UI FAIL / blocked-network ERROR; API server received zero requests.");
  } finally {
    api.server.closeAllConnections(); await new Promise<void>((resolve) => api.server.close(() => resolve()));
    if (vite && vite.exitCode === null) {
      if (process.platform === "win32") await exec("taskkill", ["/PID", String(vite.pid), "/T", "/F"], { windowsHide: true }).catch(() => undefined);
      else vite.kill("SIGTERM");
    }
  }
}
