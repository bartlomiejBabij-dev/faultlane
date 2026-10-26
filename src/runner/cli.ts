import { parseArgs } from "node:util";
import { ZodError } from "zod";
import { loadConfig } from "./load-config";
import { runFaultLane } from "./browser";
import { exitCode, summarize } from "./results";

const help = `FaultLane — Find failures before users do.

Usage: npm run faultlane -- run [--config faultlane.config.ts] [--scenario http-500]

Scenarios: baseline, http-500, http-429, slow, network, empty
Baseline always runs. Only HTTP(S) loopback targets and browser GET API calls are supported.
Exit codes: 0 = all PASS, 1 = UI FAIL, 2 = configuration / execution / report ERROR.
Config files are executable local TypeScript; load only trusted files.`;

async function main() {
  const parse = () => parseArgs({ allowPositionals: true, options: { config: { type: "string" }, scenario: { type: "string" }, help: { type: "boolean" } } });
  let args: ReturnType<typeof parse>;
  try { args = parse(); }
  catch { console.error("Invalid arguments.\n" + help); return 2; }
  if (args.values.help) { console.log(help); return 0; }
  if (args.positionals.length !== 1 || args.positionals[0] !== "run") { console.error(help); return 2; }
  let config;
  try { config = await loadConfig(args.values.config); }
  catch (error) {
    console.error(error instanceof ZodError ? `Invalid configuration:\n${error.issues.map((issue) => `- ${issue.path.join(".")}: ${issue.message}`).join("\n")}` : "Could not load the trusted local config. Check its path, syntax and default export.");
    return 2;
  }
  try {
    const { run, directory } = await runFaultLane(config, { only: args.values.scenario, onResult: (result) => console.log(`${result.status.padEnd(5)} ${result.id.padEnd(10)} ${result.durationMs} ms · intercepted ${result.interceptedRequests}\n      ${result.observation}`) });
    const counts = summarize(run.results);
    console.log(`\n${counts.pass} PASS / ${counts.fail} FAIL / ${counts.error} ERROR\nReport: ${directory}`);
    return exitCode(run.results);
  } catch {
    console.error("Run could not complete. Check the scenario name, configured scenarios and report directory permissions. No successful run is claimed.");
    return 2;
  }
}

process.exitCode = await main();
