import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseCliArgs } from "../../src/runner/cli-args";
import { collectSetup, configurationFromSetup, parseSetupLocator, renderConfiguration, setupSchema, writeConfiguration } from "../../src/runner/init";
import { detectProject } from "../../src/runner/project";
import { initConfigPath, resolveLocalPath, safeOutputPath } from "../../src/runner/paths";
import { reportDirectoryCheck, supportedNode } from "../../src/runner/doctor";
import { loadConfig } from "../../src/runner/load-config";

const setup = {
  url: "http://127.0.0.1:3456", page: "/orders", api: "/api/orders", failure: "http-500",
  trigger: "click", "click-name": "Fetch orders", "success-locator": "role:region:Orders", "success-text": "Order 123",
  "failure-locator": "role:alert:Orders problem", "failure-text": "Orders unavailable",
};
const temp = () => mkdtemp(path.join(os.tmpdir(), "faultlane-onboarding-"));

describe("CLI argument contract", () => {
  it.each([[], ["--help"], ["run", "--help"], ["init", "--help"]].map((args) => ({ args })))("shows help for $args", ({ args }) => expect(parseCliArgs(args).command).toBe("help"));
  it("accepts version, init, doctor, browser install and old run flags", () => {
    expect(parseCliArgs(["--version"]).command).toBe("version");
    expect(parseCliArgs(["browsers", "install"]).command).toBe("browsers");
    expect(parseCliArgs(["init", "--yes", "--url", setup.url]).values.yes).toBe(true);
    expect(parseCliArgs(["doctor", "--config", "custom.ts"]).command).toBe("doctor");
    expect(parseCliArgs(["run", "--scenario", "http-500", "--no-color"]).values.scenario).toBe("http-500");
  });
  it.each([["run", "--scenario", "unknown"], ["run", "--url", setup.url], ["init", "--yes", "--yes"], ["doctor", "extra"], ["init", "--url"], ["scan"], ["browsers", "install", "--anything"]].map((args) => ({ args })))("rejects invalid arguments $args", ({ args }) => expect(() => parseCliArgs(args)).toThrow());
});

describe("onboarding reuses the existing schema", () => {
  it.each(["http-500", "http-429", "network", "empty", "slow"])("generates valid %s configuration", (failure) => {
    const config = configurationFromSetup({ ...setup, failure, "loading-locator": "role:status:Waiting" });
    expect(config.scenarios[0]?.id).toBe(failure);
    expect(config.baseline.assertions[0]).toMatchObject({ state: "text", text: "Order 123" });
  });
  it("requires positive baseline and fault expectations, and real recovery fields", () => {
    expect(() => configurationFromSetup({ url: setup.url, page: "/", api: "/api/x", failure: "http-500" })).toThrow();
    expect(() => configurationFromSetup({ ...setup, "success-text": " " })).toThrow();
    expect(() => configurationFromSetup({ ...setup, recovery: true })).toThrow();
    expect(() => configurationFromSetup({ ...setup, failure: "slow" })).toThrow();
    expect(() => configurationFromSetup({ ...setup, failure: "network", recovery: true, "retry-name": "Retry", "loading-locator": "testId:loading" })).toThrow();
    const config = configurationFromSetup({ ...setup, recovery: true, "retry-name": "Try again", "loading-locator": "testId:busy" });
    expect(config.scenarios[0]).toMatchObject({ affectRequests: 1, recovery: { actions: [{ type: "click" }] } });
    expect(config.scenarios[0]?.recovery?.assertions.map((a) => a.state)).toEqual(["text", "hidden", "hidden", "textAbsent"]);
  });
  it.each(["https://example.com", "http://192.168.1.2", "http://user:secret@localhost:3000", "http://localhost:3000/path"])("rejects unsafe URL %s", (url) => expect(setupSchema.safeParse({ ...setup, url }).success).toBe(false));
  it("supports names containing colons, labels and IDs, but no CSS or eval", () => {
    expect(parseSetupLocator("role:button:Load: orders")).toEqual({ by: "role", role: "button", name: "Load: orders" });
    expect(parseSetupLocator("label:Category")).toEqual({ by: "label", value: "Category" });
    expect(() => parseSetupLocator("css:#app")).toThrow();
    expect(() => configurationFromSetup({ ...setup, eval: "anything" })).toThrow();
  });
  it("guides interactive answers, reprompts invalid input and never guesses text", async () => {
    const answers = ["https://example.com", setup.url, "/orders", "/api/orders", "click", "button", "Fetch orders", "http-500", "role:region:Orders", "Order 123", "role:alert:Orders problem", "Orders unavailable", "y", "Try again", "role:status:Waiting", "reports"];
    const prompts: string[] = [];
    const options = await collectSetup({}, { framework: "Next.js", scripts: ["dev"], suggestedUrl: "http://127.0.0.1:3000", packageFound: true }, async (prompt) => { prompts.push(prompt); if (!answers.length) throw new Error("Unexpected prompt"); return answers.shift()!; });
    expect(options.recovery).toBe(true);
    expect(prompts.some((p) => p.includes("Invalid url"))).toBe(true);
    expect(answers).toHaveLength(0);
    expect(configurationFromSetup(options).scenarios[0]?.recovery).toBeDefined();
  });
});

describe("local files and trusted config loading", () => {
  it("detects dependency names and common script names without executing them", async () => {
    const dir = await temp();
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ dependencies: { vite: "*", react: "*" }, scripts: { dev: "never execute", start: "never execute" } }));
    expect(await detectProject(dir)).toMatchObject({ framework: "Vite", scripts: ["dev", "start"], suggestedUrl: "http://127.0.0.1:5173" });
  });
  it("preserves exact old contents and only replaces with explicit backup", async () => {
    const dir = await temp(); const file = path.join(dir, "faultlane.config.ts");
    const original = "// własne zmiany\r\nexport default {};\r\n";
    await writeFile(file, original);
    await expect(writeConfiguration(file, "new", false)).rejects.toThrow("already exists");
    expect(await readFile(file, "utf8")).toBe(original);
    const backup = await writeConfiguration(file, "new", true);
    expect(await readFile(backup!, "utf8")).toBe(original);
    expect(await readFile(file, "utf8")).toBe("new");
  });
  it.each(["module", "commonjs"])("loads generated TypeScript in an external %s project", async (type) => {
    const dir = await temp();
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ type }));
    const config = configurationFromSetup(setup);
    await writeFile(path.join(dir, "faultlane.config.ts"), renderConfiguration(config));
    expect(await loadConfig(undefined, dir)).toEqual(config);
  });
  it("rejects traversal and junction outputs, preserves explicit absolute reports paths", async () => {
    const dir = await temp();
    expect(() => resolveLocalPath("../outside", dir)).toThrow();
    expect(() => resolveLocalPath("//server/share", dir)).toThrow();
    expect(resolveLocalPath("nested/reports", dir)).toBe(path.join(dir, "nested/reports"));
    expect(resolveLocalPath(dir, process.cwd())).toBe(dir);
    await expect(initConfigPath("../outside.ts", dir)).rejects.toThrow();
    await expect(initConfigPath("config.js", dir)).rejects.toThrow();
    const outside = await temp();
    await symlink(outside, path.join(dir, "linked"), "junction");
    await expect(safeOutputPath("linked/reports", dir)).rejects.toThrow("symlinks");
  });
  it("checks directory permissions without writing or creating reports", async () => {
    const dir = await temp(); const before = await readdir(dir);
    expect((await reportDirectoryCheck("reports", dir)).status).toBe("WARNING");
    expect((await reportDirectoryCheck(dir, dir)).status).toBe("PASS");
    expect((await reportDirectoryCheck("../out", dir)).status).toBe("ERROR");
    expect(await readdir(dir)).toEqual(before);
  });
  it("checks supported Node release lines", () => {
    for (const version of ["22.13.0", "22.23.4", "24.0.0", "26.0.0"]) expect(supportedNode(version)).toBe(true);
    for (const version of ["20.19.0", "22.12.0", "23.0.0", "not-version"]) expect(supportedNode(version)).toBe(false);
  });
});
