import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "../../src/runner/config";
import { runFaultLane } from "../../src/runner/browser";

const exec = promisify(execFile);
test("real runs detect a regression and improvement, and failed evidence yields CLI exit 2", async ({}, info) => {
  let broken = false; let sabotage: "baseline" | "failure" | undefined;
  const reportsDir = info.outputPath("reports");
  const server = createServer((request, response) => { void (async () => {
    if (request.url === "/api/data") { response.writeHead(200, { "Content-Type": "application/json" }).end("{}"); return; }
    if (sabotage) {
      const dirs = await readdir(reportsDir);
      const latest = dirs.sort().at(-1)!;
      await writeFile(path.join(reportsDir, latest, sabotage === "baseline" ? "baseline-step-001.png" : "http-500-step-004.png"), "sentinel", { flag: "wx" });
      sabotage = undefined;
    }
    response.writeHead(200, { "Content-Type": "text/html" }).end(`<html><body><div data-testid="content"></div><div data-testid="error"></div><script>fetch('/api/data').then(r => { if (!r.ok) throw Error(); document.querySelector('[data-testid=content]').textContent='ready' }).catch(() => { document.querySelector('[data-testid=error]').textContent=${JSON.stringify(broken ? "wrong" : "unavailable")} })</script></body></html>`);
  })().catch(() => { response.writeHead(500).end(); }); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture port");
  const input = { baseUrl: `http://127.0.0.1:${address.port}`, pagePath: "/", api: { pathname: "/api/data", method: "GET" as const }, reportsDir,
    baseline: { assertions: [{ testId: "content", state: "text" as const, text: "ready" }] },
    scenarios: [{ id: "http-500" as const, assertions: [{ testId: "error", state: "text" as const, text: "unavailable" }] }],
    timeouts: { navigationMs: 5000, requestMs: 2000, assertionMs: 500, scenarioMs: 15000 } };
  try {
    const healthy = await runFaultLane(defineConfig(input));
    broken = true;
    const failed = await runFaultLane(defineConfig(input));
    expect(healthy.run.results.map((r) => r.status)).toEqual(["PASS", "PASS"]);
    expect(failed.run.results.map((r) => r.status)).toEqual(["PASS", "FAIL"]);
    const cli = path.resolve("src/runner/cli.ts");
    const a = path.join(healthy.directory, "results.json"); const b = path.join(failed.directory, "results.json");
    await expect(exec(process.execPath, ["--import", "tsx", cli, "compare", "--base", a, "--head", b], { cwd: info.outputPath() })).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining("REGRESSION http-500") });
    const improvement = await exec(process.execPath, ["--import", "tsx", cli, "compare", "--base", b, "--head", a], { cwd: info.outputPath() });
    expect(improvement.stdout).toContain("IMPROVEMENT http-500");
    broken = false; sabotage = "baseline";
    const configFile = info.outputPath("faultlane.config.ts");
    await writeFile(configFile, `export default ${JSON.stringify(input)};`);
    let output = "";
    try { await exec(process.execPath, ["--import", "tsx", cli, "run", "--config", configFile, "--scenario", "baseline"], { cwd: process.cwd() }); throw new Error("CLI unexpectedly succeeded"); }
    catch (error) { const failure = error as { code: number; stdout: string }; expect(failure.code).toBe(2); output = failure.stdout; }
    expect(output).toContain("EVIDENCE_WRITE"); expect(output).toContain("publish: EEXIST");
    const directory = output.match(/Report: (.+)/)?.[1]?.trim(); expect(directory).toBeTruthy();
    expect(await readFile(path.join(directory!, "baseline-step-001.png"), "utf8")).toBe("sentinel");
    const report = JSON.parse(await readFile(path.join(directory!, "results.json"), "utf8")) as { results: { evidence: { status: string } }[] };
    expect(report.results[0]?.evidence.status).toBe("FAILED");
    broken = true; sabotage = "failure";
    let bothOutput = "";
    try { await exec(process.execPath, ["--import", "tsx", cli, "run", "--config", configFile], { cwd: process.cwd() }); throw new Error("CLI unexpectedly succeeded"); }
    catch (error) { const failure = error as { code: number; stdout: string }; expect(failure.code).toBe(2); bothOutput = failure.stdout; }
    const bothDir = bothOutput.match(/Report: (.+)/)?.[1]?.trim(); expect(bothDir).toBeTruthy();
    const both = JSON.parse(await readFile(path.join(bothDir!, "results.json"), "utf8")) as { results: { status: string; code: string; evidence: { status: string; failures: string[] } }[] };
    expect(both.results[1]).toMatchObject({ status: "FAIL", code: "ASSERTION_FAILED", evidence: { status: "FAILED" } });
    expect(both.results[1]?.evidence.failures.join(" ")).toContain("publish: EEXIST");
    const invalidOutput = info.outputPath("not-a-directory");
    await writeFile(invalidOutput, "preserved");
    await writeFile(configFile, `export default ${JSON.stringify({ ...input, reportsDir: invalidOutput })};`);
    try { await exec(process.execPath, ["--import", "tsx", cli, "run", "--config", configFile], { cwd: process.cwd() }); throw new Error("CLI unexpectedly succeeded"); }
    catch (error) { const failure = error as { code: number; stdout: string; stderr: string }; expect(failure.code).toBe(2); expect(failure.stderr).toContain("run-directory"); expect(failure.stdout).not.toContain("Report:"); }
    expect(await readFile(invalidOutput, "utf8")).toBe("preserved");
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
