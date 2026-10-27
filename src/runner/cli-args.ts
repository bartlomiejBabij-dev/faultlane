import { parseArgs } from "node:util";
import { z } from "zod";
import { scenarioIdSchema } from "./config";

const stringOption = { type: "string" } as const;
const booleanOption = { type: "boolean" } as const;
const common = { config: stringOption, help: booleanOption, "no-color": booleanOption };
const init = {
  ...common, yes: booleanOption, backup: booleanOption, url: stringOption, page: stringOption, api: stringOption, failure: stringOption,
  trigger: stringOption, "click-role": stringOption, "click-name": stringOption, "success-locator": stringOption, "success-text": stringOption,
  "failure-locator": stringOption, "failure-text": stringOption, "loading-locator": stringOption, "retry-name": stringOption,
  recovery: booleanOption, "delay-ms": stringOption, "reports-dir": stringOption,
};
const rawValue = z.union([z.string().max(2000), z.boolean()]);
export type CliArguments = { command: "help" | "version" | "init" | "run" | "doctor" | "browsers"; values: Record<string, string | boolean | undefined> };
export function parseCliArgs(argv: string[]): CliArguments {
  if (argv.length === 0) return { command: "help", values: {} };
  if (argv.length === 1 && ["--version", "-v"].includes(argv[0]!)) return { command: "version", values: {} };
  if (argv.every((arg) => ["--help", "-h", "--no-color"].includes(arg))) return { command: "help", values: {} };
  const command = z.enum(["init", "run", "doctor", "browsers"]).parse(argv[0]);
  if (command === "browsers") {
    if (argv.length !== 2 || argv[1] !== "install") throw new Error("Use faultlane browsers install.");
    return { command, values: {} };
  }
  const options = command === "init" ? init : command === "run" ? { ...common, scenario: stringOption } : common;
  const parsed = parseArgs({ args: argv.slice(1), options, strict: true, allowPositionals: false, tokens: true });
  const seen = new Set<string>();
  for (const token of parsed.tokens) if (token.kind === "option") {
    if (seen.has(token.name)) throw new Error("Repeated options are not supported.");
    seen.add(token.name);
  }
  const values = z.record(z.string(), rawValue).parse(parsed.values);
  if (values.scenario) scenarioIdSchema.parse(values.scenario);
  return { command: values.help ? "help" : command, values };
}

export const cliHelp = `FaultLane — local browser API failure tests

faultlane --help | --version
faultlane init                         Interactive setup in your application directory
faultlane init --yes [options]         No prompts; explicit expectations required
faultlane doctor [--config FILE]       Read-only environment and target checks
faultlane run [--config FILE] [--scenario ID] [--no-color]
faultlane browsers install             Explicitly download matching Chromium

init options:
  --url ORIGIN --page /path --api /api/path --failure http-500|http-429|network|slow|empty
  --trigger auto|click [--click-role button --click-name "Load items"]
  --success-locator "role:region:Items" --success-text "Example item"
  --failure-locator "role:alert:Problem" --failure-text "Could not load"
  --loading-locator "role:status:Loading" --retry-name "Retry" --recovery
  --delay-ms 3000 --reports-dir reports --config faultlane.config.ts
  --backup   Explicitly preserve an existing config as a unique .bak before replacing it
  --yes      Never prompt; refuses existing config unless --backup is also supplied

Locators: role:ROLE[:EXACT ACCESSIBLE NAME], label:EXACT LABEL, testId:ID.
Slow requires a loading locator; success expectations are checked after the delay.
Recovery requires http-500, failure + success text, Retry name and loading locator.
Baseline always runs. Scenarios: baseline, http-500, http-429, network, slow, empty.
Paths resolve from the current directory, including reportsDir (not the CLI installation).
Only HTTP(S) loopback targets and same-origin browser GET API calls are supported.
Exit codes: 0 = success / all PASS; 1 = UI FAIL; 2 = configuration / execution ERROR.
Doctor: PASS / WARNING / ERROR; WARNING alone exits 0 and is not a test PASS.
Config files execute trusted local TypeScript. No public npm release; use a local tarball/link.
Colors: --no-color or NO_COLOR. No automatic browser download.`;
