import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Assertion, type FaultLaneConfigInput } from "../../src/runner/config";
import { runFaultLane } from "../../src/runner/browser";
import { exitCode, runResultSchema, type ScenarioResult } from "../../src/runner/results";
import { closeTestApi, startTestApi, startViteFixture } from "../helpers/compatibility-fixtures";

const exec = promisify(execFile);
const cardData = { cards: [{ id: 11, caption: "Prepare garden map" }, { id: 12, caption: "Check seed supply" }] };
const taskData = [{ id: "spruce", label: "Inspect greenhouse" }, { id: "birch", label: "Water seedlings" }];
const text = (role: "region" | "alert", name: string, value: string): Assertion => ({ locator: { by: "role", role, name }, state: "text", text: value });
const boardHealthy: Assertion[] = [text("region", "Garden cards", "Prepare garden map"), { locator: { by: "label", value: "Board account" }, state: "text", text: "Garden team" }];
const boardProblem = [text("alert", "Board problem", "The board could not be loaded.")];
const taskHealthy: Assertion[] = [text("region", "Open task list", "Inspect greenhouse"), { locator: { by: "label", value: "Orchard team" }, state: "text", text: "Orchard crew" }, { locator: { by: "label", value: "REST range" }, state: "text", text: "0-1/2" }];

let board: Awaited<ReturnType<typeof startViteFixture>>;
let orchard: Awaited<ReturnType<typeof startViteFixture>>;
let api: Awaited<ReturnType<typeof startTestApi>>;
let otherApi: Awaited<ReturnType<typeof startTestApi>>;
test.beforeAll(async () => {
  [board, orchard, api, otherApi] = await Promise.all([startViteFixture("react-board"), startViteFixture("supabase-tasks"), startTestApi(), startTestApi()]);
});
test.afterAll(async () => { await Promise.all([board?.server.close(), orchard?.server.close(), api && closeTestApi(api), otherApi && closeTestApi(otherApi)]); });

function boardConfig(reportsDir: string, apiOrigin = api.url): FaultLaneConfigInput {
  return {
    name: "Independent React cross-origin board", baseUrl: board.url, pagePath: `/?api=${encodeURIComponent(apiOrigin)}`,
    network: { mockOrigins: [apiOrigin] },
    endpoints: [
      { id: "cards", match: { origin: apiOrigin, method: "GET", pathname: "/v2/cards", query: { lane: "ready" } }, response: { type: "mock", json: cardData }, maxRequests: 3 },
      { id: "account", match: { origin: apiOrigin, pathname: "/v2/session" }, response: { type: "mock", json: { displayName: "Garden team" } }, maxRequests: 1 },
    ],
    actions: [{ type: "click", locator: { by: "role", role: "button", name: "Open board" } }],
    baseline: { assertions: [...boardHealthy] },
    scenarios: [{ id: "http-500", targets: [{ id: "cards", sequence: [{ type: "http-500" }, { type: "mock", json: cardData }], expectedRequests: 2 }], assertions: [...boardProblem],
      sequenceRecovery: { actions: [{ type: "click", locator: { by: "role", role: "button", name: "Reload cards" } }], assertions: [...boardHealthy, { locator: { by: "role", role: "alert", name: "Board problem" }, state: "hidden" }] } }],
    reportsDir, timeouts: { navigationMs: 20_000, requestMs: 1500, assertionMs: 1500, scenarioMs: 40_000 },
  };
}

function restConfig(reportsDir: string): FaultLaneConfigInput {
  return {
    name: "Independent Supabase REST collection", baseUrl: orchard.url, pagePath: `/?api=${encodeURIComponent(api.url)}`,
    network: { mockOrigins: [api.url] },
    endpoints: [
      { id: "tasks", match: { origin: api.url, pathname: "/rest/v1/tasks", query: { select: "id,label", status: "eq.open" } }, response: { type: "mock", json: taskData }, format: "supabase-rest", maxRequests: 2 },
      { id: "team", match: { origin: api.url, pathname: "/rest/v1/teams", query: { select: "title" } }, response: { type: "mock", json: [{ title: "Orchard crew" }] }, format: "supabase-rest", maxRequests: 1 },
    ],
    actions: [{ type: "click", locator: { by: "role", role: "button", name: "Find open tasks" } }], baseline: { assertions: [...taskHealthy] },
    scenarios: [
      { id: "http-500", targets: [{ id: "tasks", sequence: [{ type: "http-500" }, { type: "mock", json: taskData }], expectedRequests: 2 }], assertions: [text("alert", "Task notice", "Tasks are unavailable.")], sequenceRecovery: { actions: [{ type: "click", locator: { by: "role", role: "button", name: "Refresh checklist" } }], assertions: taskHealthy } },
      { id: "http-429", targets: [{ id: "tasks", sequence: [{ type: "http-429", retryAfterSeconds: 1 }], expectedRequests: 1 }], assertions: [text("alert", "Task notice", "Tasks are rate limited.")] },
      { id: "network", targets: [{ id: "tasks", sequence: [{ type: "network" }], expectedRequests: 1 }], assertions: [text("alert", "Task notice", "Tasks are unavailable.")] },
      { id: "empty", targets: [{ id: "tasks", sequence: [{ type: "empty" }], expectedRequests: 1 }], assertions: [text("region", "Open task list", "There are no open tasks.")] },
      { id: "slow", delayMs: 1800, targets: [{ id: "tasks", sequence: [{ type: "slow", delayMs: 1800, response: { type: "mock", json: taskData } }], expectedRequests: 1 }], duringDelay: [{ locator: { by: "role", role: "status", name: "Task lookup" }, state: "visible" }], assertions: taskHealthy },
    ], reportsDir, timeouts: { navigationMs: 20_000, requestMs: 1500, assertionMs: 1500, scenarioMs: 40_000 },
  };
}

function endpoint(result: ScenarioResult, id: string) {
  const found = result.endpoints?.find((item) => item.id === id);
  expect(found, `Missing endpoint evidence: ${id}`).toBeTruthy();
  return found!;
}

test("React cross-origin manual 500 recovery has independent counters and never contacts the API", async ({}, info) => {
  const before = api.requests.length;
  const { run, directory } = await runFaultLane(defineConfig(boardConfig(info.outputPath("reports"))));
  expect(run.results.map((result) => result.status)).toEqual(["PASS", "PASS"]);
  expect(api.requests.length).toBe(before);
  const failure = run.results[1]!;
  expect(endpoint(failure, "cards")).toMatchObject({ observedRequests: 2, interceptedRequests: 2, faultedRequests: 1 });
  expect(endpoint(failure, "cards").requests).toMatchObject([{ ordinal: 1, outcome: "simulated", status: 500 }, { ordinal: 2, outcome: "mocked", status: 200, phase: "recovery" }]);
  expect(endpoint(failure, "account")).toMatchObject({ observedRequests: 1, interceptedRequests: 1, faultedRequests: 0 });
  expect(failure.network?.blockedRequests).toBe(0);
  expect(runResultSchema.parse(JSON.parse(await readFile(path.join(directory, "results.json"), "utf8")))).toEqual(run);
  const markdown = await readFile(path.join(directory, "report.md"), "utf8");
  expect(markdown).toContain("cards");
  for (const secret of ["synthetic-board-query-secret", "synthetic-dependency-secret"]) {
    expect(JSON.stringify(run)).not.toContain(secret); expect(markdown).not.toContain(secret);
  }
});

test("an explicitly mocked HTTPS .invalid origin works without any remote API", async ({}, info) => {
  const { run } = await runFaultLane(defineConfig(boardConfig(info.outputPath("reports"), "https://api.fixture.invalid")));
  expect(run.results.map((result) => result.status)).toEqual(["PASS", "PASS"]);
  expect(endpoint(run.results[1]!, "cards").origin).toBe("https://api.fixture.invalid");
  expect(run.results[1]?.network?.events.filter((event) => event.origin === "https://api.fixture.invalid").every((event) => ["mocked", "preflight"].includes(event.decision))).toBe(true);
});

test("explicit POST matching mocks a mutating browser request without reaching any API", async ({}, info) => {
  const config = boardConfig(info.outputPath("reports"));
  config.pagePath += "&method=post";
  config.endpoints![0]!.match.method = "POST";
  const before = api.requests.length;
  const { run } = await runFaultLane(defineConfig(config));
  expect(run.results.map((result) => result.status)).toEqual(["PASS", "PASS"]);
  expect(api.requests.length).toBe(before);
  expect(endpoint(run.results[1]!, "cards")).toMatchObject({ method: "POST", interceptedRequests: 2 });
  expect(run.results[1]?.network?.events.filter((event) => event.endpointId === "cards" && event.decision !== "preflight").map((event) => event.method)).toEqual(["POST", "POST"]);
  expect(JSON.stringify(run)).not.toContain("synthetic-request-body-secret");
});

test("React automatic backoff proves 429, 429, 200 through three actual browser requests", async ({}, info) => {
  const config = boardConfig(info.outputPath("reports"));
  config.pagePath += "&mode=auto";
  config.scenarios = [{ id: "http-429", targets: [{ id: "cards", sequence: [{ type: "http-429", retryAfterSeconds: 1 }, { type: "http-429", retryAfterSeconds: 1 }, { type: "mock", json: cardData }], expectedRequests: 3 }], assertions: [...boardHealthy, { locator: { by: "label", value: "Board attempt" }, state: "text", text: "Attempt 3" }] }];
  const { run } = await runFaultLane(defineConfig(config));
  expect(run.results.map((result) => result.status)).toEqual(["PASS", "PASS"]);
  expect(endpoint(run.results[1]!, "cards").requests.map((request) => [request.ordinal, request.status])).toEqual([[1, 429], [2, 429], [3, 200]]);
  expect(endpoint(run.results[1]!, "account").interceptedRequests).toBe(1);
});

test("concurrent requests reserve independent sequence ordinals before response completion", async ({}, info) => {
  const config = boardConfig(info.outputPath("reports"));
  config.pagePath += "&concurrent=1"; config.endpoints![0]!.expectedRequests = 2;
  config.scenarios = [{ id: "slow", delayMs: 1800, duringDelay: [{ locator: { by: "role", role: "status", name: "Board progress" }, state: "visible" }], targets: [{ id: "cards", sequence: [{ type: "slow", delayMs: 1800, response: { type: "mock", json: cardData } }, { type: "mock", json: { cards: [{ id: 13, caption: "Second concurrent result" }] } }], expectedRequests: 2 }], assertions: [...boardHealthy, text("region", "Garden cards", "Second concurrent result")] }];
  const { run } = await runFaultLane(defineConfig(config));
  expect(run.results.map((result) => result.status)).toEqual(["PASS", "PASS"]);
  expect(endpoint(run.results[1]!, "cards").requests.map((request) => [request.ordinal, request.outcome])).toEqual([[1, "simulated"], [2, "mocked"]]);
  expect(endpoint(run.results[1]!, "account").interceptedRequests).toBe(1);
});

test("sequential slow responses retain the full declared delay budget", async ({}, info) => {
  const config = boardConfig(info.outputPath("reports"));
  config.pagePath += "&serial=1";
  config.endpoints![0]!.expectedRequests = 2;
  config.timeouts!.requestMs = 1000;
  config.scenarios = [{ id: "slow", delayMs: 3000,
    duringDelay: [{ locator: { by: "role", role: "status", name: "Board progress" }, state: "visible" }],
    targets: [{ id: "cards", expectedRequests: 2, sequence: [
      { type: "slow", delayMs: 3000, response: { type: "mock", json: cardData } },
      { type: "slow", delayMs: 3000, response: { type: "mock", json: { cards: [{ id: 13, caption: "Second sequential result" }] } } },
    ] }],
    assertions: [...boardHealthy, text("region", "Garden cards", "Second sequential result"),
      { locator: { by: "label", value: "Board attempt" }, state: "text", text: "Attempt 2" }],
  }];
  const before = api.requests.length;
  const { run } = await runFaultLane(defineConfig(config));
  expect(run.results.map((result) => result.status)).toEqual(["PASS", "PASS"]);
  expect(endpoint(run.results[1]!, "cards")).toMatchObject({ observedRequests: 2, interceptedRequests: 2, faultedRequests: 2 });
  expect(endpoint(run.results[1]!, "cards").requests.map((request) => [request.ordinal, request.outcome, request.status])).toEqual([[1, "simulated", 200], [2, "simulated", 200]]);
  expect(api.requests.length).toBe(before);
});

test("Supabase-style REST validates query, JSON errors, CORS exposed range and all five faults", async ({}, info) => {
  const before = api.requests.length;
  const { run, directory } = await runFaultLane(defineConfig(restConfig(info.outputPath("reports"))));
  expect(run.results.map((result) => result.status)).toEqual(Array(6).fill("PASS"));
  expect(api.requests.length).toBe(before);
  for (const result of run.results) {
    expect(endpoint(result, "team")).toMatchObject({ interceptedRequests: 1, faultedRequests: 0 });
    expect(result.assertions.every((assertion) => assertion.passed)).toBe(true);
    expect(result.screenshot).toBeTruthy();
  }
  expect(endpoint(run.results[1]!, "tasks").requests.map((request) => request.status)).toEqual([500, 200]);
  expect(run.results.find((result) => result.id === "slow")?.loadingScreenshot).toBe("slow-loading.png");
  const evidence = JSON.stringify(run) + await readFile(path.join(directory, "report.md"), "utf8");
  for (const secret of ["synthetic-rest-query-secret", "synthetic-anon-fixture-key", "synthetic-browser-fixture-token", "Bearer "]) expect(evidence).not.toContain(secret);
  expect(endpoint(run.results[0]!, "tasks").queryKeys).toEqual(["select", "status"]);
});

for (const mismatch of ["method", "path", "query", "origin"] as const) {
  test(`incorrect target ${mismatch} produces ERROR with zero-match evidence`, async ({}, info) => {
    const config = boardConfig(info.outputPath("reports"));
    const matcher = config.endpoints![0]!.match;
    if (mismatch === "method") matcher.method = "POST";
    if (mismatch === "path") matcher.pathname = "/v2/not-cards";
    if (mismatch === "query") matcher.query = { lane: "other" };
    if (mismatch === "origin") { matcher.origin = otherApi.url; config.network!.mockOrigins!.push(otherApi.url); }
    const before = api.requests.length;
    const { run } = await runFaultLane(defineConfig(config), { only: "baseline" });
    expect(run.results[0]).toMatchObject({ status: "ERROR", code: "API_NOT_OBSERVED" });
    expect(run.results[0]?.network?.zeroMatchTargets).toContain("cards");
    expect(run.results[0]?.network?.hypotheses.length).toBeGreaterThan(0);
    expect(run.results[0]?.network?.events).toEqual(expect.arrayContaining([expect.objectContaining({ method: "GET", pathname: "/v2/cards", decision: "blocked" })]));
    expect(api.requests.length).toBe(before); expect(exitCode(run.results)).toBe(2);
  });
}

for (const bug of ["ignore-error", "no-request"] as const) {
  test(`React UI defect ${bug} is real FAIL with CLI exit 1`, async ({}, info) => {
    const config = boardConfig(info.outputPath("reports")); config.pagePath += `&bug=${bug}`;
    const filename = info.outputPath("faultlane.config.ts");
    await writeFile(filename, `export default ${JSON.stringify(config, null, 2)};\n`);
    let code = 0; let output = "";
    try { output = (await exec(process.execPath, ["--import", "tsx", "src/runner/cli.ts", "run", "--config", filename, "--no-color"], { timeout: 90_000, maxBuffer: 1_000_000 })).stdout; }
    catch (error) { const failed = error as { code: number; stdout: string; stderr: string }; code = failed.code; output = failed.stdout + failed.stderr; }
    expect(code, output).toBe(1);
    const directory = output.match(/Report: (.+)/)?.[1]?.trim(); expect(directory).toBeTruthy();
    const run = runResultSchema.parse(JSON.parse(await readFile(path.join(directory!, "results.json"), "utf8")));
    expect(run.results.map((result) => result.status)).toEqual(["PASS", "FAIL"]);
    expect(run.results[1]?.code).toBe(bug === "ignore-error" ? "ASSERTION_FAILED" : "RECOVERY_REQUEST_MISSING");
    expect(endpoint(run.results[1]!, "cards").interceptedRequests).toBe(1);
  });
}

test("Supabase-style incorrect UI produces FAIL instead of a fabricated successful fault test", async ({}, info) => {
  const config = restConfig(info.outputPath("reports")); config.pagePath += "&bug=ignore-error";
  const { run } = await runFaultLane(defineConfig(config), { only: "http-500" });
  expect(run.results.map((result) => result.status)).toEqual(["PASS", "FAIL"]);
  expect(run.results[1]?.code).toBe("ASSERTION_FAILED");
});

test("unmatched request on a permitted mock origin is blocked before reaching its server", async ({}, info) => {
  const config = boardConfig(info.outputPath("reports")); config.pagePath += "&dependency=unknown";
  config.baseline.assertions.push({ locator: { by: "label", value: "Dependency outcome" }, state: "text", text: "Dependency blocked" });
  const before = api.requests.length;
  const { run } = await runFaultLane(defineConfig(config), { only: "baseline" });
  expect(run.results[0]).toMatchObject({ status: "ERROR", code: "NETWORK_POLICY_BLOCKED" });
  expect(run.results[0]?.network?.events).toEqual(expect.arrayContaining([expect.objectContaining({ origin: api.url, pathname: "/unexpected", decision: "blocked" })]));
  expect(api.requests.length).toBe(before);
});

test("unknown cross-origin dependency is blocked and narrow image permission does not permit fetch", async ({}, info) => {
  const config = boardConfig(info.outputPath("reports"));
  config.pagePath += `&asset=1&dependency=asset-fetch&dependencyApi=${encodeURIComponent(otherApi.url)}`;
  config.network!.assets = [api.url, otherApi.url].map((origin) => ({ origin, pathname: "/assets/leaf.svg", resourceTypes: ["image"] }));
  config.baseline.assertions.push({ locator: { by: "label", value: "Dependency outcome" }, state: "text", text: "Dependency blocked" });
  const before = api.requests.length; const beforeOther = otherApi.requests.length;
  const { run } = await runFaultLane(defineConfig(config), { only: "baseline" });
  expect(run.results[0]).toMatchObject({ status: "ERROR", code: "NETWORK_POLICY_BLOCKED" });
  expect(api.requests.slice(before)).toEqual([{ method: "GET", pathname: "/assets/leaf.svg" }]);
  expect(otherApi.requests.length).toBe(beforeOther);
  expect(run.results[0]?.network?.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ pathname: "/assets/leaf.svg", resourceType: "image", decision: "allowed-asset" }),
    expect.objectContaining({ origin: otherApi.url, pathname: "/assets/leaf.svg", resourceType: "fetch", decision: "blocked" }),
  ]));
});

test("explicit local forwarding reaches only the configured unrelated endpoint", async ({}, info) => {
  const config = boardConfig(info.outputPath("reports"));
  config.network!.localOrigins = [api.url]; config.endpoints![1]!.response = { type: "forward" };
  const before = api.requests.length;
  const { run } = await runFaultLane(defineConfig(config));
  expect(run.results.map((result) => result.status)).toEqual(["PASS", "PASS"]);
  expect(api.requests.slice(before).filter((request) => request.method !== "OPTIONS")).toEqual([{ method: "GET", pathname: "/v2/session" }, { method: "GET", pathname: "/v2/session" }]);
  expect(endpoint(run.results[1]!, "account").requests).toMatchObject([{ outcome: "forwarded", status: 200 }]);
  expect(endpoint(run.results[1]!, "cards").requests.every((request) => request.outcome !== "forwarded")).toBe(true);
});

for (const destination of ["local", "external"] as const) {
  test(`local forwarding blocks a ${destination} redirect without requesting its destination`, async ({}, info) => {
    const config = boardConfig(info.outputPath("reports"));
    const pathname = destination === "local" ? "/v2/redirect-local" : "/v2/redirect";
    config.pagePath += `&route=${destination === "local" ? "redirect-local" : "redirect"}`;
    config.network!.localOrigins = [api.url];
    config.endpoints![0]!.match.pathname = pathname;
    config.endpoints![0]!.response = { type: "forward" };
    const before = api.requests.length;
    const { run } = await runFaultLane(defineConfig(config), { only: "baseline" });
    expect(run.results[0]).toMatchObject({ status: "ERROR", code: "ROUTE_EXECUTION" });
    expect(endpoint(run.results[0]!, "cards").requests).toMatchObject([{ outcome: "error", status: null }]);
    expect(api.requests.slice(before)).toEqual([{ method: "GET", pathname }]);
    expect(run.results[0]?.network?.events.some((event) => event.pathname === "/unexpected" || event.origin === "https://never-contact.fixture.invalid")).toBe(false);
  });
}

test("dashboard renders real v3 endpoint sequences and network evidence on desktop and mobile", async ({ page, request }, info) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error" && /hydrat|server rendered/i.test(message.text())) hydrationErrors.push("Hydration mismatch"); });
  const { run } = await runFaultLane(defineConfig(boardConfig("reports")));
  expect(run.results.map((result) => result.status)).toEqual(["PASS", "PASS"]);
  await page.goto("/results");
  const report = page.getByTestId("run").filter({ hasText: run.id });
  await expect(report).toBeVisible();
  const scenario = report.locator("details.scenario").nth(1);
  await scenario.locator(":scope > summary").click();
  const evidence = scenario.getByTestId("network-evidence");
  await expect(evidence).toContainText("Mocked responses do not prove that the real API is available.");
  const cards = evidence.getByTestId("endpoint-evidence").filter({ hasText: "cards · GET /v2/cards" });
  await cards.locator(":scope > summary").click();
  await expect(cards.locator(":scope > summary")).toContainText("2/2 expected requests");
  await expect(cards.getByRole("table", { name: "Expected response sequence · cards" })).toContainText("http-500");
  const actual = cards.getByRole("table", { name: "Actual response sequence · cards" });
  await expect(actual.getByRole("row").nth(1)).toContainText("simulated");
  await expect(actual.getByRole("row").nth(1)).toContainText("500");
  await expect(actual.getByRole("row").nth(2)).toContainText("mocked");
  await expect(actual.getByRole("row").nth(2)).toContainText("200");
  await evidence.getByText(/^Browser network evidence ·/).click();
  await expect(evidence.getByRole("table", { name: "Observed browser requests · query values redacted" })).toContainText("/v2/cards");
  await expect(evidence).not.toContainText("synthetic-board-query-secret");
  const jsonLink = report.getByRole("link", { name: "JSON ↓" });
  const response = await request.get((await jsonLink.getAttribute("href"))!);
  expect(response.status()).toBe(200);
  expect(runResultSchema.parse(await response.json())).toEqual(run);
  await evidence.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("network-desktop.png"), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("network-mobile.png"), fullPage: false });
  expect(hydrationErrors).toEqual([]);
});
