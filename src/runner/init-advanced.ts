import { open } from "node:fs/promises";
import { z } from "zod";
import { configSchema, failureIds, type Assertion, type FaultLaneConfig } from "./config";
import { endpointSchema, endpointMatcherSchema, isLoopbackOrigin, networkPolicySchema, sequenceResponseSchema, type EndpointDefinition, type NetworkPolicy } from "./endpoint-schema";
import { pagePathSchema } from "./journey-schema";
import { parseSetupLocator, type Ask } from "./init";
import type { ProjectInfo } from "./project";
import { CliInputError } from "./cli-error";
import { safeOutputPath } from "./paths";
import { validateEndpointConfiguration } from "./network-policy";

export async function readAdvancedConfiguration(filename: string, cwd: string): Promise<FaultLaneConfig> {
  if (!filename.endsWith(".json") || filename.startsWith("\\\\") || filename.startsWith("//") || /[\x00-\x1f]/.test(filename)) throw new CliInputError("--from-json requires an explicitly selected local .json file.");
  const file = await open(await safeOutputPath(filename, cwd), "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 1_000_000) throw new CliInputError("Advanced JSON must be a regular file no larger than 1 MB.");
    const buffer = Buffer.alloc(1_000_001);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > 1_000_000) throw new CliInputError("Advanced JSON must be no larger than 1 MB.");
    const config = configSchema.parse(JSON.parse(buffer.subarray(0, size).toString("utf8")));
    if (!config.endpoints) throw new CliInputError("Advanced configuration requires endpoints; use normal init for the legacy single API wizard.");
    return config;
  } finally { await file.close(); }
}

export async function collectAdvancedSetup(project: ProjectInfo, ask: Ask): Promise<FaultLaneConfig> {
  async function read<T>(label: string, schema: z.ZodType<T>, fallback?: string): Promise<T> {
    while (true) {
      const value = (await ask(`${label}${fallback === undefined ? "" : ` [${fallback || "Enter = none"}]`}: `)).trim() || fallback;
      const parsed = schema.safeParse(value);
      if (parsed.success) return parsed.data;
      label = `Invalid input. ${label.replace(/^Invalid input\. /, "")}`;
    }
  }
  async function json<T>(label: string, schema: z.ZodType<T>, fallback?: string): Promise<T> {
    return read(label, z.string().transform((text, ctx) => {
      try { const value: unknown = JSON.parse(text); const parsed = schema.safeParse(value); if (parsed.success) return parsed.data; }
      catch { /* Do not echo user input or raw JSON errors. */ }
      ctx.addIssue({ code: "custom", message: "Invalid declarative JSON" }); return z.NEVER;
    }), fallback);
  }
  const text = z.string().min(1).max(300);
  const yes = async (label: string) => (await read(label, z.enum(["y", "n"]), "n")) === "y";
  const locator = (click = false) => read("Locator (role:ROLE:NAME, label:LABEL or testId:ID)", text.refine((value) => { try { const parsed = parseSetupLocator(value); return !click || parsed.by !== "role" || !!parsed.name; } catch { return false; } })).then(parseSetupLocator);
  const assertion = async (label: string): Promise<Assertion> => {
    await ask(`${label} — press Enter to enter its locator and expected text. `);
    return { locator: await locator(), state: "text", text: await read("Expected visible text (required, never guessed)", text) };
  };
  const baseUrl = await read("Local application origin", configSchema.shape.baseUrl, project.suggestedUrl);
  const pagePath = await read("Page path", pagePathSchema, "/");
  const count = await read("Number of API endpoints (1–10)", z.coerce.number().int().min(1).max(10), "1");
  const endpoints: EndpointDefinition[] = [];
  const network: NetworkPolicy = { mockOrigins: [], localOrigins: [], assets: [] };
  for (let i = 0; i < count; i++) {
    const id = await read(`Endpoint ${i + 1} unique ID`, endpointSchema.shape.id.refine((value) => !endpoints.some((endpoint) => endpoint.id === value)), `api${i + 1}`);
    const origin = await read("API origin (same as app, or explicit cross-origin)", endpointMatcherSchema.shape.origin.unwrap(), new URL(baseUrl).origin);
    const pathname = await read("API pathname (exact or trailing /*)", endpointMatcherSchema.shape.pathname);
    const method = await read("HTTP method (mutating methods can only be mocked)", endpointMatcherSchema.shape.method, "GET");
    const query = await json("Exact query conditions as JSON (values are omitted from reports)", endpointMatcherSchema.shape.query.unwrap(), "{}");
    const format = await read("Response format: json or supabase-rest (GET collections only)", endpointSchema.shape.format.refine((value) => value !== "supabase-rest" || method === "GET"), "json");
    const expectedRequests = await read("Exact baseline request count", z.coerce.number().int().min(1).max(30), "1");
    const maxRequests = await read("Maximum requests in any scenario for this endpoint", z.coerce.number().int().min(expectedRequests).max(30), String(Math.max(10, expectedRequests)));
    const type = await read("Baseline response: mock or forward (forward permits local GET/HEAD only)", z.enum(["mock", "forward"]).refine((value) => value !== "forward" || (isLoopbackOrigin(origin) && ["GET", "HEAD"].includes(method))), "mock");
    const fixtureSchema = endpointSchema.shape.response.options[0].shape.json.refine((value) => format !== "supabase-rest" || Array.isArray(value));
    const response = type === "forward" ? { type } as const : { type, status: 200, json: await json("Synthetic successful response JSON (required; Supabase collections use arrays)", fixtureSchema) } as const;
    if (origin !== new URL(baseUrl).origin && !network.mockOrigins.includes(origin)) {
      if (!await yes("Explicitly permit mocking requests to this origin? y/n (does not contact its API)")) throw new CliInputError("Cross-origin interception permission declined; no configuration written.");
      network.mockOrigins.push(origin);
    }
    if (type === "forward" && origin !== new URL(baseUrl).origin) {
      if (!await yes("Explicitly allow real read-only requests to this loopback API? y/n")) throw new CliInputError("Local forwarding permission declined; no configuration written.");
      network.localOrigins.push(origin);
    }
    endpoints.push(endpointSchema.parse({ id, match: { origin, pathname, method, query }, response, format, expectedRequests, maxRequests }));
    if (validateEndpointConfiguration(endpoints, baseUrl, network).length) throw new CliInputError("Endpoint matchers conflict. Restart advanced init with disjoint origins, methods, paths or exact query conditions, or use --from-json with a corrected configuration. No file was written.");
  }
  const actions = [];
  if (await yes("Does loading require an explicit click? y/n")) actions.push({ type: "click" as const, locator: await locator(true) });
  const success = await assertion("Baseline success expectation");
  const failure = await read("Failure: http-500, http-429, network, empty or slow", z.enum(failureIds), "http-500");
  const targetId = await read("Endpoint ID to fault", text.refine((id) => endpoints.some((endpoint) => endpoint.id === id)), endpoints[0]!.id);
  const delayMs = failure === "slow" ? await read("Slow response delay in milliseconds", z.coerce.number().int().min(500).max(10_000), "3000") : undefined;
  const target = endpoints.find((endpoint) => endpoint.id === targetId)!;
  const defaultSequence = failure === "slow" ? [{ type: "slow", delayMs, response: target.response }] : [{ type: failure }];
  // Uprawnienie do przekazywania lokalnego recovery jest pytaniem oddzielnym
  // od zgody na mockowanie. Nie trafia do konfiguracji bez jawnego "y".
  const targetOrigin = target.match.origin ?? new URL(baseUrl).origin;
  const canGrantLocalForward = targetOrigin !== new URL(baseUrl).origin && isLoopbackOrigin(targetOrigin) && ["GET", "HEAD"].includes(target.match.method);
  const candidatePolicy = canGrantLocalForward ? { ...network, localOrigins: [...network.localOrigins, targetOrigin] } : network;
  const sequenceSchema = z.array(sequenceResponseSchema).min(1).max(target.maxRequests).refine((items) => items.some((item) => item.type === failure) && validateEndpointConfiguration(endpoints, baseUrl, candidatePolicy, [{ id: targetId, expectedRequests: items.length, sequence: items }]).length === 0);
  const sequence = await json("Bounded response sequence JSON (include the selected fault; add explicit mock/local forward success for recovery)", sequenceSchema, JSON.stringify(defaultSequence));
  if (canGrantLocalForward && !network.localOrigins.includes(targetOrigin) && sequence.some((item) => item.type === "forward" || (item.type === "slow" && item.response.type === "forward"))) {
    if (!await yes("Explicitly allow real read-only requests to this loopback API during the sequence? y/n")) throw new CliInputError("Local forwarding permission declined; no configuration written.");
    network.localOrigins.push(targetOrigin);
  }
  const manual = (await read("Verify error UI, then perform a recovery click? y/n (y requires a final success response; n supports automatic backoff)", z.enum(["y", "n"]).refine((value) => value === "n" || ["mock", "forward"].includes(sequence.at(-1)!.type)), "n")) === "y";
  const after = await assertion(manual ? "Fault UI expectation before recovery" : "Final scenario expectation after the full sequence");
  const sequenceRecovery = manual ? { actions: [{ type: "click", locator: await locator(true) }], assertions: [await assertion("Recovered UI expectation")] } : undefined;
  const duringDelay = failure === "slow" ? [{ locator: await locator(), state: "visible" }] : undefined;
  network.assets = await json("Optional static asset permissions JSON (origin + pathname + resourceTypes; never fetch/XHR)", networkPolicySchema.unwrap().shape.assets, "[]");
  const reportsDir = await read("Local reports directory", z.string().min(1).max(240), "reports");
  return configSchema.parse({ baseUrl, pagePath, endpoints, network, actions, reportsDir, baseline: { assertions: [success] }, scenarios: [{ id: failure, assertions: [after], targets: [{ id: targetId, expectedRequests: sequence.length, sequence }], ...(sequenceRecovery ? { sequenceRecovery } : {}), ...(failure === "slow" ? { delayMs, duringDelay } : {}) }] });
}
