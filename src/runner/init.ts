import { constants } from "node:fs";
import { copyFile, lstat, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { z } from "zod";
import { configSchema, failureIds, type Assertion, type FaultLaneConfig, type LocatorConfig } from "./config";
import { apiSchema, locatorSchema, pagePathSchema } from "./journey-schema";
import { detectProject, type ProjectInfo } from "./project";
import { initConfigPath, safeOutputPath } from "./paths";
import { CliInputError } from "./cli-error";

export function parseSetupLocator(value: string): LocatorConfig {
  const [by, first, ...rest] = value.split(":");
  if (by === "role") return locatorSchema.parse({ by, role: first, ...(rest.length ? { name: rest.join(":") } : {}) });
  if (by === "label" || by === "testId") return locatorSchema.parse({ by, value: [first, ...rest].join(":") });
  throw new CliInputError("Use role:ROLE[:NAME], label:LABEL or testId:ID.");
}
const text = z.string().trim().min(1).max(300);
const setupLocator = text.refine((value) => { try { parseSetupLocator(value); return true; } catch { return false; } }, "Use role:ROLE[:NAME], label:LABEL or testId:ID with a supported locator.");
export const setupSchema = z.object({
  url: configSchema.shape.baseUrl,
  page: pagePathSchema,
  api: apiSchema.shape.pathname,
  failure: z.enum(failureIds),
  trigger: z.enum(["auto", "click"]).default("auto"),
  "click-role": z.enum(["button", "link"]).default("button"),
  "click-name": text.optional(),
  "success-locator": setupLocator,
  "success-text": text,
  "failure-locator": setupLocator.optional(),
  "failure-text": text.optional(),
  "loading-locator": setupLocator.optional(),
  "retry-name": text.optional(),
  recovery: z.boolean().default(false),
  "delay-ms": z.coerce.number().int().min(500).max(10_000).default(3000),
  "reports-dir": z.string().min(1).max(240).default("reports"),
}).strict().superRefine((value, ctx) => {
  const required = (key: keyof typeof value) => { if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: `--${key} is required; UI expectations are never invented.` }); };
  if (value.trigger === "click") required("click-name");
  if (value.failure === "slow") required("loading-locator");
  else { required("failure-locator"); required("failure-text"); }
  if (value.recovery) {
    if (value.failure !== "http-500") ctx.addIssue({ code: "custom", path: ["recovery"], message: "The recovery wizard supports HTTP 500 only." });
    required("retry-name"); required("loading-locator"); required("failure-locator"); required("failure-text");
  }
});
export type SetupOptions = z.infer<typeof setupSchema>;
export type Ask = (message: string) => Promise<string>;

export function configurationFromSetup(input: unknown): FaultLaneConfig {
  const options = setupSchema.parse(input);
  const success: Assertion = { locator: parseSetupLocator(options["success-locator"]), state: "text", text: options["success-text"] };
  const loading = options["loading-locator"] ? parseSetupLocator(options["loading-locator"]) : undefined;
  const done: Assertion[] = [success, ...(loading ? [{ locator: loading, state: "hidden" as const }] : [])];
  const fault: Assertion[] = options.failure === "slow" ? [...done] : [
    { locator: parseSetupLocator(options["failure-locator"]!), state: "text", text: options["failure-text"]! },
    ...(options["retry-name"] ? [{ locator: { by: "role" as const, role: "button" as const, name: options["retry-name"] }, state: "visible" as const }] : []),
    ...(loading ? [{ locator: loading, state: "hidden" as const }] : []),
  ];
  return configSchema.parse({
    name: "Local application reliability", baseUrl: options.url, pagePath: options.page,
    api: { pathname: options.api, method: "GET" }, reportsDir: options["reports-dir"],
    actions: options.trigger === "click" ? [{ type: "click", locator: { by: "role", role: options["click-role"], name: options["click-name"] } }] : [],
    maxRequests: options.recovery ? 2 : 20,
    baseline: { assertions: done },
    scenarios: [{ id: options.failure, assertions: fault,
      ...(options.failure === "slow" ? { delayMs: options["delay-ms"], duringDelay: [{ locator: loading, state: "visible" }] } : {}),
      ...(options.recovery ? { affectRequests: 1, recovery: {
        actions: [{ type: "click", locator: { by: "role", role: "button", name: options["retry-name"] } }],
        assertions: [...done, { locator: parseSetupLocator(options["failure-locator"]!), state: "hidden" }, { locator: parseSetupLocator(options["failure-locator"]!), state: "textAbsent", text: options["failure-text"] }],
      } } : {}),
    }],
  });
}

export async function collectSetup(values: Record<string, string | boolean | undefined>, project: ProjectInfo, ask: Ask): Promise<SetupOptions> {
  const answers: Record<string, unknown> = { ...values };
  async function read(key: string, label: string, schema: z.ZodType, fallback?: string, optional = false): Promise<void> {
    if (values[key] !== undefined) { answers[key] = schema.parse(values[key]); return; }
    while (true) {
      const answer = (await ask(`${label}${fallback ? ` [${fallback}]` : optional ? " [Enter = skip]" : ""}: `)).trim() || fallback;
      if (!answer && optional) return;
      const result = schema.safeParse(answer);
      if (result.success) { answers[key] = result.data; return; }
      // Never echo the supplied value (it may contain a private URL or terminal codes).
      label = `Invalid ${key}; ${label}`;
    }
  }
  await read("url", "Application URL (suggested port; verify your dev server)", setupSchema.shape.url, project.suggestedUrl);
  await read("page", "Page path", pagePathSchema, "/");
  await read("api", "Browser GET API pathname (optional * wildcard)", setupSchema.shape.api);
  await read("trigger", "Request trigger: auto or click", setupSchema.shape.trigger, "auto");
  if (answers.trigger === "click") {
    await read("click-role", "Trigger role: button or link", setupSchema.shape["click-role"], "button");
    await read("click-name", "Exact accessible trigger name", text);
  }
  await read("failure", "Failure: http-500, http-429, network, slow, empty", setupSchema.shape.failure, "http-500");
  await read("success-locator", "Success locator (role:ROLE[:NAME], label:LABEL, testId:ID)", setupLocator);
  await read("success-text", "Text that must appear after a real successful response", text);
  if (answers.failure !== "slow") {
    await read("failure-locator", "Expected fault/empty-state locator", setupLocator);
    await read("failure-text", "Text that must appear after this fault", text);
  } else await read("delay-ms", "Delay in milliseconds", setupSchema.shape["delay-ms"], "3000");
  if (answers.failure === "http-500") {
    if (values.recovery !== undefined) answers.recovery = values.recovery;
    else answers.recovery = (await ask("Also test Retry followed by a real HTTP 2xx response? [y/N]: ")).trim().toLowerCase() === "y";
  }
  if (answers.failure !== "slow" && answers.failure !== "empty") await read("retry-name", "Exact accessible Retry button name", text, undefined, !answers.recovery);
  await read("loading-locator", "Loading indicator locator", setupLocator, undefined, !answers.recovery && answers.failure !== "slow");
  await read("reports-dir", "Local reports directory", setupSchema.shape["reports-dir"], "reports");
  return setupSchema.parse(answers);
}

export function renderConfiguration(config: FaultLaneConfig): string {
  return `// Wygenerowano lokalnie przez FaultLane. Sprawdź oczekiwania przed uruchomieniem.\n// Import typu jest usuwany w runtime; globalny npm link nie wymaga importu pakietu w aplikacji.\nimport type { FaultLaneConfigInput } from "faultlane/config";\n\nexport default ${JSON.stringify(config, null, 2)} satisfies FaultLaneConfigInput;\n`;
}

export async function writeConfiguration(filename: string, source: string, backup: boolean): Promise<string | undefined> {
  let existing: Buffer | undefined;
  try {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink()) throw new CliInputError("Configuration must be a regular local file.");
    existing = await readFile(filename);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (existing && !backup) throw new CliInputError("Configuration already exists. Leave it unchanged or explicitly use --backup.");
  let backupPath: string | undefined;
  if (existing) {
    backupPath = `${filename}.${randomUUID()}.bak`;
    await copyFile(filename, backupPath, constants.COPYFILE_EXCL);
    if (!(await readFile(filename)).equals(existing)) throw new CliInputError("Configuration changed during setup; no replacement was written.");
  }
  await writeFile(filename, source, { encoding: "utf8", flag: existing ? "w" : "wx", mode: 0o600 });
  return backupPath;
}

export async function initialize(values: Record<string, string | boolean | undefined>, cwd: string, log: (message: string) => void): Promise<void> {
  const filename = await initConfigPath(typeof values.config === "string" ? values.config : "faultlane.config.ts", cwd);
  if (!values.yes && !process.stdin.isTTY) throw new CliInputError("Interactive init requires a terminal. Use init --yes with explicit success and failure expectations; see --help.");
  const project = await detectProject(cwd);
  log(project.packageFound ? `Application detected: ${project.framework}. Development scripts found: ${project.scripts.join(", ") || "none"}. Port is a suggestion only.` : "No readable package.json detected. Application details must be supplied explicitly.");
  const terminal = values.yes ? undefined : createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const lines = terminal?.[Symbol.asyncIterator]();
  const ask: Ask = async (message) => {
    process.stdout.write(message);
    const answer = await lines!.next();
    if (answer.done) throw new CliInputError("Setup cancelled; no configuration written.");
    return answer.value;
  };
  try {
    let backup = values.backup === true;
    let exists = false;
    try { await lstat(filename); exists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (exists && !backup) {
      if (values.yes) throw new CliInputError("Configuration already exists. No changes made. Use --backup explicitly to preserve and replace it.");
      backup = (await ask("Configuration exists. Keep unchanged or back up and replace? [keep/backup]: ")).trim() === "backup";
      if (!backup) { log("Existing configuration left unchanged."); return; }
    }
    const setupValues = Object.fromEntries(Object.entries(values).filter(([key]) => !["yes", "backup", "config", "no-color", "help"].includes(key)));
    const options = values.yes ? setupSchema.parse(setupValues) : await collectSetup(setupValues, project, ask);
    await safeOutputPath(options["reports-dir"], cwd);
    const config = configurationFromSetup(options);
    const savedBackup = await writeConfiguration(filename, renderConfiguration(config), backup);
    if (savedBackup) log(`Backup saved: ${savedBackup}`);
    log(`Configuration created: ${filename}\nReview the expectations. Start your application in another terminal.\nThen run: faultlane doctor${values.config ? ` --config "${values.config}"` : ""}\nThen run: faultlane run${values.config ? ` --config "${values.config}"` : ""}\nIf Chromium is missing: faultlane browsers install`);
  } finally { terminal?.close(); }
}
