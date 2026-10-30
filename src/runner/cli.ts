#!/usr/bin/env node
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { ZodError } from "zod";
import { cliHelp, parseCliArgs } from "./cli-args";
import { loadConfig } from "./load-config";
import { exitCode, summarize } from "./results";
import { initialize } from "./init";
import { diagnose, supportedNode } from "./doctor";
import { safeOutputPath } from "./paths";
import { CliInputError } from "./cli-error";

declare const FAULTLANE_VERSION: string;
function safeText(message: string): string { return message.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ""); }

async function main(): Promise<number> {
  let args: ReturnType<typeof parseCliArgs>;
  try { args = parseCliArgs(process.argv.slice(2)); }
  catch { console.error("Invalid arguments. Use faultlane --help. Unknown, repeated and misplaced options are rejected."); return 2; }
  if (args.command === "help") { console.log(cliHelp); return 0; }
  if (args.command === "version") {
    const version = typeof FAULTLANE_VERSION === "string" ? FAULTLANE_VERSION : (JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
    console.log(version); return 0;
  }
  const color = process.stdout.isTTY && !args.values["no-color"] && process.env.NO_COLOR === undefined;
  const log = (message: string) => {
    const clean = safeText(message);
    console.log(color ? clean.replace(/\b(PASS|FAIL|ERROR|WARNING)\b/g, (status) => "\x1b[" + (status === "PASS" ? 32 : status === "WARNING" ? 33 : 31) + "m" + status + "\x1b[0m") : clean);
  };
  try {
    if (args.command === "doctor") {
      const checks = await diagnose(typeof args.values.config === "string" ? args.values.config : undefined);
      for (const check of checks) log(check.status.padEnd(7) + " " + check.name + ": " + check.message);
      log("Doctor checks setup only. It does not certify application behavior or API interception.");
      return checks.some((check) => check.status === "ERROR") ? 2 : 0;
    }
    if (!supportedNode(process.versions.node)) { log("ERROR Unsupported Node.js. Use 22.13+, 24.x or 26.x."); return 2; }
    if (args.command === "browsers") {
      const require = createRequire(import.meta.url);
      const installer = require.resolve("@playwright/test/cli");
      log("Installing the Chromium revision required by this FaultLane package (explicit request).");
      return await new Promise<number>((resolve) => {
        const child = spawn(process.execPath, [installer, "install", "chromium"], { stdio: "inherit", shell: false });
        child.on("error", () => resolve(2)); child.on("exit", (code) => resolve(code === 0 ? 0 : 2));
      });
    }
    if (args.command === "init") { await initialize(args.values, process.cwd(), log); return 0; }
    const config = await loadConfig(typeof args.values.config === "string" ? args.values.config : undefined);
    config.reportsDir = await safeOutputPath(config.reportsDir, process.cwd());
    if (config.endpoints) log(`Network policy: ${config.endpoints.length} explicit endpoints; ${config.network?.mockOrigins.length ?? 0} mock origins; ${config.network?.assets.length ?? 0} asset rules. External APIs are never forwarded; unmatched APIs are blocked. Service workers are blocked.`);
    log("Configuration loaded and validated. Starting Chromium…");
    const { runFaultLane } = await import("./browser");
    const { run, directory } = await runFaultLane(config, {
      only: typeof args.values.scenario === "string" ? args.values.scenario : undefined,
      onBrowserReady: () => log("Chromium ready."),
      onScenarioStart: (id) => log("Running " + id + "…"),
      onResult: (result) => {
        log(result.status.padEnd(5) + " " + result.id.padEnd(10) + " " + result.durationMs + " ms · observed " + result.observedRequests + " / intercepted " + result.interceptedRequests + " / faulted " + result.faultedRequests + "\n      " + (result.code ? "[" + result.code + "] " : "") + result.observation + (result.failedStep ? " (step " + result.failedStep + ")" : ""));
        log("      Verified UI assertions: " + result.assertions.filter((a) => a.passed).length + "/" + result.assertions.length + "; step screenshots saved: " + (result.steps?.filter((s) => s.screenshot).length ?? 0) + ".");
        if (result.status !== "PASS") log("      " + result.suggestion);
        for (const endpoint of result.endpoints ?? []) log(`      ${endpoint.id}: ${endpoint.method} ${endpoint.origin}${endpoint.pathname} · observed ${endpoint.observedRequests} / intercepted ${endpoint.interceptedRequests} / expected ${endpoint.expectedRequests} / blocked ${endpoint.blockedRequests}`);
        if (result.network) {
          log(`      Network: ${result.network.mockedRequests} mocked / ${result.network.allowedRequests} explicitly allowed / ${result.network.blockedRequests} blocked. Query values and headers omitted.`);
          if (result.network.zeroMatchTargets.length) log("      Zero matches: " + result.network.zeroMatchTargets.join(", "));
          for (const hypothesis of result.network.hypotheses) log("      Hypothesis: " + hypothesis);
        }
      },
    });
    const counts = summarize(run.results);
    log("\n" + counts.pass + " PASS / " + counts.fail + " FAIL / " + counts.error + " ERROR\nReport: " + directory + "\nOpen locally: " + path.join(directory, "report.md"));
    if (counts.error) log("For environment checks run: faultlane doctor. Missing Chromium: faultlane browsers install.");
    return exitCode(run.results);
  } catch (error) {
    if (error instanceof ZodError) log("ERROR Invalid configuration or setup values:\n" + error.issues.map((issue) => "- " + issue.path.join(".") + ": " + issue.message).join("\n") + "\nUse faultlane --help. Explicit positive UI expectations are required.");
    else if (error instanceof CliInputError) log("ERROR " + error.message);
    else log("ERROR Could not complete the command. Check the trusted config path/default export, configured scenario and local report permissions. Use faultlane doctor. No successful run is claimed.");
    return 2;
  }
}

process.exitCode = await main();
