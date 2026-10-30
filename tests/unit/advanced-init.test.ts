import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { configSchema, type FaultLaneConfigInput } from "../../src/runner/config";
import { collectAdvancedSetup, readAdvancedConfiguration } from "../../src/runner/init-advanced";
import { initialize } from "../../src/runner/init";
import { parseCliArgs } from "../../src/runner/cli-args";
import { loadConfig } from "../../src/runner/load-config";
import type { ProjectInfo } from "../../src/runner/project";
import legacy from "../../faultlane.recovery.config";

const app = "http://127.0.0.1:5173";
const remote = "https://fixture.supabase.invalid";
const project: ProjectInfo = { framework: "Vite", scripts: ["dev"], suggestedUrl: app, packageFound: true };
const fixture = [{ id: 1, title: "Water seedlings" }];
const positive = [{ locator: { by: "role" as const, role: "region" as const, name: "Task list" }, state: "text" as const, text: "Water seedlings" }];
const configuration = (): FaultLaneConfigInput => ({
  baseUrl: app, pagePath: "/workspace", network: { mockOrigins: [remote] },
  endpoints: [{ id: "tasks", match: { origin: remote, pathname: "/rest/v1/tasks", query: { status: "eq.open" } }, response: { type: "mock", json: fixture }, format: "supabase-rest", maxRequests: 3 }],
  baseline: { assertions: positive },
  scenarios: [{ id: "http-500", assertions: [{ locator: { by: "role", role: "alert", name: "Task problem" }, state: "text", text: "Tasks unavailable" }], targets: [{ id: "tasks", expectedRequests: 2, sequence: [{ type: "http-500" }, { type: "mock", json: fixture }] }], sequenceRecovery: { actions: [{ type: "click", locator: { by: "role", role: "button", name: "Refresh tasks" } }], assertions: positive } }],
});
const temp = () => mkdtemp(path.join(os.tmpdir(), "faultlane-advanced-init-"));
async function settingsFile(value: unknown = configuration()): Promise<string> {
  const dir = await temp();
  await writeFile(path.join(dir, "settings.json"), JSON.stringify(value));
  return dir;
}
async function runAnswers(answers: string[]): Promise<{ config: Awaited<ReturnType<typeof collectAdvancedSetup>>; prompts: string[] }> {
  const remaining = [...answers]; const prompts: string[] = [];
  const config = await collectAdvancedSetup(project, async (prompt) => {
    prompts.push(prompt);
    if (!remaining.length) throw new Error(`Unexpected extra prompt: ${prompt}`);
    return remaining.shift()!;
  });
  expect(remaining).toEqual([]);
  return { config, prompts };
}
const endpointAnswers = (origin = remote, pathname = "/rest/v1/tasks", format = "supabase-rest") => [
  "tasks", origin, pathname, "GET", '{"status":"eq.open"}', format, "1", "3", "mock", JSON.stringify(fixture), ...(origin === app ? [] : ["y"]),
];

describe("advanced init reads only validated local declarative JSON", () => {
  it("accepts the public advanced flags and creates a loadable typed config without writing reports", async () => {
    const dir = await settingsFile(); const output: string[] = [];
    const args = parseCliArgs(["init", "--advanced", "--yes", "--from-json", "settings.json", "--config", "app-test.mts"]);
    await initialize(args.values, dir, (message) => output.push(message));
    const source = await readFile(path.join(dir, "app-test.mts"), "utf8");
    expect(source).toContain('import type { FaultLaneConfigInput } from "faultlane/config"');
    expect(await loadConfig("app-test.mts", dir)).toEqual(configSchema.parse(configuration()));
    expect((await readdir(dir)).sort()).toEqual(["app-test.mts", "settings.json"]);
    expect(output.join("\n")).toContain("Configuration created");
    expect(output.join("\n")).not.toContain("Water seedlings");
  });
  it("preserves an existing configuration byte-for-byte unless backup is explicit", async () => {
    const dir = await settingsFile();
    const original = "// własne zmiany\r\nexport default { confidential: true };\r\n";
    await writeFile(path.join(dir, "faultlane.config.ts"), original);
    const values = { advanced: true, yes: true, "from-json": "settings.json" };
    await expect(initialize(values, dir, () => undefined)).rejects.toThrow("already exists");
    expect(await readFile(path.join(dir, "faultlane.config.ts"), "utf8")).toBe(original);
    expect((await readdir(dir)).filter((name) => name.endsWith(".bak"))).toEqual([]);
    await initialize({ ...values, backup: true }, dir, () => undefined);
    const backups = (await readdir(dir)).filter((name) => name.endsWith(".bak"));
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(dir, backups[0]!), "utf8")).toBe(original);
    expect(await loadConfig(undefined, dir)).toEqual(configSchema.parse(configuration()));
  });
  it.each([
    { advanced: true, yes: true },
    { yes: true, "from-json": "settings.json" },
    { advanced: true, yes: true, "from-json": "settings.json", api: "/api/tasks" },
  ])("rejects incomplete or mixed advanced options without creating a config: %j", async (values) => {
    const dir = await settingsFile();
    await expect(initialize(values, dir, () => undefined)).rejects.toThrow();
    expect(await readdir(dir)).toEqual(["settings.json"]);
  });
  it("rejects invalid JSON, missing positive assertions and the legacy schema in advanced mode", async () => {
    const dir = await settingsFile(); const file = path.join(dir, "settings.json");
    await writeFile(file, '{"not-json":');
    await expect(readAdvancedConfiguration("settings.json", dir)).rejects.toThrow();
    await writeFile(file, JSON.stringify({ ...configuration(), baseline: { assertions: [] } }));
    await expect(readAdvancedConfiguration("settings.json", dir)).rejects.toThrow();
    await writeFile(file, JSON.stringify(legacy));
    await expect(readAdvancedConfiguration("settings.json", dir)).rejects.toThrow("requires endpoints");
  });
  it("rejects remote forwarding, undeclared origins and unsafe output before writing", async () => {
    for (const kind of ["forward", "permission", "output"] as const) {
      const input = configuration();
      if (kind === "forward") input.endpoints![0]!.response = { type: "forward" };
      if (kind === "permission") input.network = { mockOrigins: [] };
      if (kind === "output") input.reportsDir = "../outside-reports";
      const dir = await settingsFile(input);
      await expect(initialize({ advanced: true, yes: true, "from-json": "settings.json" }, dir, () => undefined)).rejects.toThrow();
      expect(await readdir(dir)).toEqual(["settings.json"]);
    }
  });
  it("rejects network, traversal, wrong extension and junction input paths", async () => {
    const dir = await settingsFile();
    for (const input of ["//server/share/settings.json", "\\\\server\\share\\settings.json", "../settings.json", "settings.ts", "settings.json\u0000"]) await expect(readAdvancedConfiguration(input, dir)).rejects.toThrow();
    const outside = await settingsFile();
    await symlink(outside, path.join(dir, "linked"), process.platform === "win32" ? "junction" : "dir");
    await expect(readAdvancedConfiguration("linked/settings.json", dir)).rejects.toThrow("symlinks");
    // Explicit absolute local input is allowed, but still validated.
    expect(await readAdvancedConfiguration(path.join(outside, "settings.json"), dir)).toEqual(configSchema.parse(configuration()));
  });
  it("rejects directories and oversized JSON before loading configuration data", async () => {
    const dir = await temp();
    await mkdir(path.join(dir, "directory.json"));
    await expect(readAdvancedConfiguration("directory.json", dir)).rejects.toThrow();
    await writeFile(path.join(dir, "huge.json"), " ".repeat(1_000_001));
    await expect(readAdvancedConfiguration("huge.json", dir)).rejects.toThrow("1 MB");
  });
});

describe("guided advanced onboarding", () => {
  it("collects Supabase query conditions, permissions, click journey and real recovery expectations", async () => {
    const { config, prompts } = await runAnswers([
      "https://wrong-app.invalid", app, "/workspace", "1", ...endpointAnswers(),
      "y", "role:button", "role:button:Load tasks", "", "role:region:Task list", "Water seedlings", "http-500", "tasks",
      JSON.stringify([{ type: "http-500" }, { type: "mock", json: fixture }]), "y", "", "role:alert:Task problem", "Tasks unavailable",
      "role:button:Refresh tasks", "", "role:region:Task list", "Water seedlings", "[]", "reports",
    ]);
    expect(config.endpoints?.[0]).toMatchObject({ id: "tasks", format: "supabase-rest", match: { origin: remote, query: { status: "eq.open" } } });
    expect(config.network).toMatchObject({ mockOrigins: [remote], localOrigins: [], assets: [] });
    expect(config.actions).toMatchObject([{ type: "click", locator: { name: "Load tasks" } }]);
    expect(config.scenarios[0]?.sequenceRecovery).toMatchObject({ actions: [{ type: "click", locator: { name: "Refresh tasks" } }], assertions: positive });
    expect(configSchema.parse(config)).toEqual(config);
    expect(prompts.filter((prompt) => prompt.startsWith("Invalid input."))).toHaveLength(2);
    expect(prompts.join("\n")).not.toContain("wrong-app.invalid");
  });
  it("supports multiple independent endpoints and automatic 429 recovery without a retry button", async () => {
    const { config } = await runAnswers([
      app, "/workspace", "2", ...endpointAnswers(),
      "profile", app, "/api/profile", "GET", "{}", "json", "1", "2", "forward",
      "n", "", "role:region:Task list", "Water seedlings", "http-429", "tasks",
      JSON.stringify([{ type: "http-429" }, { type: "http-429" }, { type: "mock", json: fixture }]), "n", "", "role:region:Task list", "Water seedlings", "[]", "reports",
    ]);
    expect(config.endpoints).toHaveLength(2);
    expect(config.endpoints?.[1]?.response.type).toBe("forward");
    expect(config.scenarios[0]?.targets?.[0]?.expectedRequests).toBe(3);
    expect(config.actions).toEqual([]);
    expect(config.scenarios[0]?.sequenceRecovery).toBeUndefined();
  });
  it("asks separately before forwarding recovery to an explicitly configured loopback origin", async () => {
    const localApi = "http://127.0.0.1:4100";
    const { config, prompts } = await runAnswers([
      app, "/workspace", "1", ...endpointAnswers(localApi, "/v1/tasks", "json"),
      "n", "", "role:region:Task list", "Water seedlings", "http-500", "tasks",
      '[{"type":"http-500"},{"type":"forward"}]', "y", "y", "", "role:alert:Task problem", "Tasks unavailable",
      "role:button:Refresh tasks", "", "role:region:Task list", "Water seedlings", "[]", "reports",
    ]);
    expect(config.network?.mockOrigins).toEqual([localApi]);
    expect(config.network?.localOrigins).toEqual([localApi]);
    expect(prompts.some((prompt) => prompt.includes("during the sequence"))).toBe(true);
  });
  it("does not invent permission when cross-origin mocking is declined", async () => {
    const answers = [app, "/", "1", ...endpointAnswers().slice(0, -1), "n"];
    await expect(collectAdvancedSetup(project, async () => {
      if (!answers.length) throw new Error("Unexpected prompt after declined permission");
      return answers.shift()!;
    })).rejects.toThrow("permission declined");
    expect(answers).toEqual([]);
  });
  it("fails promptly on ambiguous endpoint matchers instead of an endless sequence prompt", async () => {
    const answers = [app, "/", "2", ...endpointAnswers(app, "/api/tasks", "json"),
      "shadow", app, "/api/*", "GET", "{}", "json", "1", "2", "mock", "[]"];
    await expect(collectAdvancedSetup(project, async () => {
      if (!answers.length) throw new Error("Unexpected prompt after matcher conflict");
      return answers.shift()!;
    })).rejects.toThrow("matchers conflict");
    expect(answers).toEqual([]);
  });
});

describe("configuration compatibility and honest limits", () => {
  it("keeps legacy configs valid and rejects extended wait fields that legacy would ignore", () => {
    expect(configSchema.parse(legacy).api?.method).toBe("GET");
    for (const request of [{ pathname: "/api/tasks", origin: remote }, { pathname: "/api/tasks", query: { token: "fixture" } }, { pathname: "/api/tasks", method: "POST" }]) {
      expect(configSchema.safeParse({ ...legacy, actions: [{ type: "waitForRequest", request }] }).success).toBe(false);
    }
    expect(configSchema.safeParse({ ...legacy, actions: [{ type: "waitForRequest", request: { pathname: "/api/*/tasks" } }] }).success).toBe(true);
  });
  it("requires advanced waits to use the actual endpoint matcher grammar", () => {
    expect(configSchema.safeParse({ ...configuration(), actions: [{ type: "waitForRequest", request: { origin: remote, pathname: "/rest/v1/tasks", query: { status: "eq.open" } } }] }).success).toBe(true);
    expect(configSchema.safeParse({ ...configuration(), actions: [{ type: "waitForRequest", request: { pathname: "/rest/*/tasks" } }] }).success).toBe(false);
  });
  it("rejects the ignored legacy global request limit in endpoint mode", () => {
    expect(configSchema.safeParse({ ...configuration(), maxRequests: 2 }).success).toBe(false);
  });
  it("checks total delay budgets in every endpoint sequence, even for a different scenario ID", () => {
    const input = configuration();
    input.timeouts = { requestMs: 500, scenarioMs: 2500 };
    input.scenarios[0]!.targets![0]!.sequence = [{ type: "http-500" }, { type: "slow", delayMs: 1000, response: { type: "mock", json: fixture } }, { type: "slow", delayMs: 1000, response: { type: "mock", json: fixture } }];
    input.scenarios[0]!.targets![0]!.expectedRequests = 3;
    delete input.scenarios[0]!.sequenceRecovery;
    expect(configSchema.safeParse(input).success).toBe(false);
    input.timeouts.scenarioMs = 4000;
    expect(configSchema.safeParse(input).success).toBe(true);
  });
  it("rejects incomplete recovery sequences and mixed legacy endpoint definitions", () => {
    const input = configuration(); input.scenarios[0]!.targets![0]!.sequence = [{ type: "http-500" }]; input.scenarios[0]!.targets![0]!.expectedRequests = 1;
    expect(configSchema.safeParse(input).success).toBe(false);
    expect(configSchema.safeParse({ ...configuration(), api: { pathname: "/api/tasks" } }).success).toBe(false);
    expect(configSchema.safeParse({ ...legacy, network: {} }).success).toBe(false);
  });
});
