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
  recovery: booleanOption, "delay-ms": stringOption, "reports-dir": stringOption, advanced: booleanOption, "from-json": stringOption,
};
const rawValue = z.union([z.string().max(2000), z.boolean()]);
export type CliArguments = { command: "help" | "version" | "init" | "run" | "doctor" | "browsers" | "compare"; values: Record<string, string | boolean | undefined> };
export function parseCliArgs(argv: string[]): CliArguments {
  if (argv.length === 0) return { command: "help", values: {} };
  if (argv.length === 1 && ["--version", "-v"].includes(argv[0]!)) return { command: "version", values: {} };
  if (argv.every((arg) => ["--help", "-h", "--no-color"].includes(arg))) return { command: "help", values: {} };
  const command = z.enum(["init", "run", "doctor", "browsers", "compare"]).parse(argv[0]);
  if (command === "browsers") {
    if (argv.length !== 2 || argv[1] !== "install") throw new Error("Use faultlane browsers install.");
    return { command, values: {} };
  }
  const options: Record<string, { type: "string" | "boolean" }> = command === "init" ? init : command === "run" ? { ...common, scenario: stringOption } : command === "compare" ? { base: stringOption, head: stringOption, help: booleanOption, "no-color": booleanOption } : common;
  const parsed = parseArgs({ args: argv.slice(1), options, strict: true, allowPositionals: false, tokens: true });
  const seen = new Set<string>();
  for (const token of parsed.tokens) if (token.kind === "option") {
    if (seen.has(token.name)) throw new Error("Repeated options are not supported.");
    seen.add(token.name);
  }
  const values = z.record(z.string(), rawValue).parse(parsed.values);
  if (values.scenario) scenarioIdSchema.parse(values.scenario);
  if (command === "compare" && !values.help && (typeof values.base !== "string" || typeof values.head !== "string")) throw new Error("compare requires --base and --head.");
  return { command: values.help ? "help" : command, values };
}

export const cliHelp = `FaultLane — local browser API failure tests

faultlane --help | --version
faultlane init                         Interactive setup in your application directory
faultlane init --yes [options]         No prompts; explicit expectations required
faultlane init --advanced              Guided endpoints, permissions and sequences
faultlane init --advanced --yes --from-json FILE
                                      Validate explicit JSON and write a typed config
faultlane doctor [--config FILE]       Read-only environment and target checks
faultlane run [--config FILE] [--scenario ID] [--no-color]
faultlane compare --base FILE --head FILE [--no-color]
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
Application targets stay HTTP(S) loopback. Legacy api uses same-origin browser GET.
Advanced endpoints support exact origin/method/path/query matching and bounded sequences.
External API origins require mockOrigins permission; real external API forwarding is prohibited.
Explicit asset rules permit only chosen origin/path/resource types, with no browser credentials.
Advanced --from-json accepts the actual runtime configuration schema, including UI assertions.
Exit codes: 0 = success / all PASS; 1 = UI FAIL; 2 = configuration / execution ERROR.
Compare: 0 = no confirmed regressions; 1 = confirmed regression; 2 = invalid, incomparable or unavailable evidence.
Doctor: PASS / WARNING / ERROR; WARNING alone exits 0 and is not a test PASS.
Config files execute trusted local TypeScript. No public npm release; use a local tarball/link.
Colors: --no-color or NO_COLOR. No automatic browser download.`;
