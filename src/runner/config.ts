import { z } from "zod";
import { actionsSchema, apiSchema, assertionsSchema as assertions, pagePathSchema, recoverySchema, testIdSchema } from "./journey-schema";
import { endpointMatcherSchema, endpointsSchema, networkPolicySchema, targetOverridesSchema } from "./endpoint-schema";
import { validateEndpointConfiguration } from "./network-policy";
export { assertionSchema } from "./journey-schema";
export type { Assertion, Action, LocatorConfig } from "./journey-schema";

export const failureIds = ["http-500", "http-429", "slow", "network", "empty"] as const;
export const scenarioIdSchema = z.enum(["baseline", ...failureIds]);
export type ScenarioId = z.infer<typeof scenarioIdSchema>;

export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      (url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.(\d{1,3}\.){2}\d{1,3}$/.test(url.hostname));
  } catch { return false; }
}

const journey = {
  name: z.string().min(1).max(100).optional(), actions: actionsSchema.optional(), affectRequests: z.number().int().min(1).max(10).optional(), recovery: recoverySchema.optional(),
  targets: targetOverridesSchema.optional(),
  sequenceRecovery: z.object({ actions: actionsSchema, assertions }).strict().optional(),
};
const failureSchema = z.discriminatedUnion("id", [
  z.object({ ...journey, id: z.literal("http-500"), assertions }).strict(),
  z.object({ ...journey, id: z.literal("http-429"), retryAfterSeconds: z.number().int().min(1).max(300).default(30), assertions }).strict(),
  z.object({ ...journey, id: z.literal("slow"), delayMs: z.number().int().min(500).max(10_000).default(3000), duringDelay: assertions, assertions }).strict(),
  z.object({ ...journey, id: z.literal("network"), assertions }).strict(),
  z.object({ ...journey, id: z.literal("empty"), assertions }).strict(),
]);
export const configSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  baseUrl: z.string().url().refine(isLoopbackUrl, "Only HTTP(S) localhost or loopback URLs are allowed.").refine((s) => { try { const u = new URL(s); return u.pathname === "/" && !u.search && !u.hash; } catch { return false; } }, "baseUrl must be an origin without a path, query or fragment."),
  pagePath: pagePathSchema,
  api: apiSchema.optional(),
  endpoints: endpointsSchema.optional(),
  network: networkPolicySchema.unwrap().optional(),
  actions: actionsSchema.optional(),
  maxRequests: z.number().int().min(2).max(30).optional(),
  baseline: z.object({ name: z.string().min(1).max(100).optional(), actions: actionsSchema.optional(), assertions }).strict(),
  scenarios: z.array(failureSchema).min(1).max(5).refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Scenario IDs must be unique."),
  timeouts: z.object({ navigationMs: z.number().int().min(500).max(60_000).default(20_000), requestMs: z.number().int().min(500).max(30_000).default(10_000), assertionMs: z.number().int().min(100).max(15_000).default(4000), scenarioMs: z.number().int().min(2000).max(120_000).default(45_000) }).strict().default({ navigationMs: 20_000, requestMs: 10_000, assertionMs: 4000, scenarioMs: 45_000 }),
  reportsDir: z.string().min(1).max(240).default("reports"),
  maskTestIds: z.array(testIdSchema).max(30).default([]),
}).strict().superRefine((config, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const validateWaits = (actions: z.infer<typeof actionsSchema> | undefined, at: (string | number)[]) => {
    for (const [index, action] of (actions ?? []).entries()) {
      if (action.type !== "waitForRequest") continue;
      const matcher = config.endpoints ? endpointMatcherSchema : apiSchema;
      if (!matcher.safeParse(action.request).success) issue([...at, index, "request"], config.endpoints ? "Endpoint waits require the same exact origin/method/path/query matcher rules as endpoints." : "Legacy waitForRequest supports only same-origin GET pathname matching. Use endpoints mode for origin, query or other methods.");
    }
  };
  if (Number(!!config.api) + Number(!!config.endpoints) !== 1) issue(["endpoints"], "Provide either legacy api or endpoints, never both.");
  if (config.network && !config.endpoints) issue(["network"], "Explicit network permissions require endpoints mode.");
  if (config.endpoints && config.maxRequests !== undefined) issue(["maxRequests"], "Endpoint mode uses independent endpoint.maxRequests limits; the legacy global limit is not supported here.");
  validateWaits(config.actions, ["actions"]);
  validateWaits(config.baseline.actions, ["baseline", "actions"]);
  if (!isLoopbackUrl(config.baseUrl)) return;
  if (!isLoopbackUrl(new URL(config.pagePath, config.baseUrl).href)) ctx.addIssue({ code: "custom", path: ["pagePath"], message: "Page must remain on loopback." });
  for (const [index, scenario] of config.scenarios.entries()) {
    validateWaits(scenario.actions, ["scenarios", index, "actions"]);
    validateWaits(scenario.recovery?.actions, ["scenarios", index, "recovery", "actions"]);
    validateWaits(scenario.sequenceRecovery?.actions, ["scenarios", index, "sequenceRecovery", "actions"]);
    if (config.endpoints) {
      if (!scenario.targets?.length) issue(["scenarios", index, "targets"], "Endpoint scenarios require an explicit bounded fault sequence.");
      if (scenario.recovery || scenario.affectRequests !== undefined) issue(["scenarios", index], "Use targets and sequenceRecovery with endpoints; legacy recovery remains unchanged.");
      const responses = scenario.targets?.flatMap((target) => target.sequence) ?? [];
      if (!responses.some((response) => response.type === scenario.id)) issue(["scenarios", index, "targets"], "The sequence must contain the scenario's declared fault.");
      for (const [targetIndex, target] of (scenario.targets ?? []).entries()) {
        const delayedMs = target.sequence.reduce((sum, response) => sum + (response.type === "slow" ? response.delayMs : 0), 0);
        if (delayedMs + config.timeouts.requestMs >= config.timeouts.scenarioMs) issue(["scenarios", index, "targets", targetIndex, "sequence"], "The scenario timeout must exceed the total configured delays for each endpoint plus the request timeout.");
      }
      if (scenario.sequenceRecovery) {
        for (const [targetIndex, target] of (scenario.targets ?? []).entries()) {
          const last = target.sequence.at(-1);
          if (!last || !["mock", "forward"].includes(last.type)) issue(["scenarios", index, "targets", targetIndex], "Recovery sequences must end in a successful mock or local forward.");
        }
      }
      if (scenario.id === "slow" && responses.some((response) => response.type === "slow" && response.delayMs !== scenario.delayMs)) issue(["scenarios", index, "delayMs"], "Slow sequence delays must equal scenario.delayMs so duringDelay coverage is verifiable.");
    } else if (scenario.targets || scenario.sequenceRecovery) issue(["scenarios", index], "Sequences require endpoints mode.");
    if (scenario.recovery && scenario.affectRequests === undefined) ctx.addIssue({ code: "custom", path: ["scenarios", index, "affectRequests"], message: "Recovery requires an explicit number of requests to affect." });
    if ((scenario.affectRequests ?? 1) + (scenario.recovery ? 1 : 0) > (config.maxRequests ?? 20)) ctx.addIssue({ code: "custom", path: ["scenarios", index], message: "maxRequests must cover fault requests and recovery." });
    if (scenario.id === "slow" && scenario.delayMs + config.timeouts.requestMs >= config.timeouts.scenarioMs) ctx.addIssue({ code: "custom", path: ["scenarios", index], message: "Scenario timeout must exceed delay plus request timeout." });
  }
  if (config.endpoints) {
    const policy = networkPolicySchema.parse(config.network ?? {});
    for (const problem of validateEndpointConfiguration(config.endpoints, config.baseUrl, policy)) issue(problem.path, problem.message);
    for (const [index, scenario] of config.scenarios.entries()) {
      for (const problem of validateEndpointConfiguration(config.endpoints, config.baseUrl, policy, scenario.targets)) issue(["scenarios", index, ...problem.path], problem.message);
    }
  }
});
export type FaultLaneConfig = z.infer<typeof configSchema>;
export type FaultLaneConfigInput = z.input<typeof configSchema>;
export type FailureScenario = FaultLaneConfig["scenarios"][number];
export type Scenario = FailureScenario | ({ id: "baseline" } & FaultLaneConfig["baseline"]);
export function defineConfig(config: FaultLaneConfigInput & { api: z.input<typeof apiSchema> }): FaultLaneConfig & { api: z.infer<typeof apiSchema> };
export function defineConfig(config: FaultLaneConfigInput): FaultLaneConfig;
export function defineConfig(config: FaultLaneConfigInput): FaultLaneConfig { return configSchema.parse(config); }

export function selectScenarios(config: FaultLaneConfig, only?: string): Scenario[] {
  if (only && !scenarioIdSchema.safeParse(only).success) throw new Error("Unknown scenario. Use baseline, http-500, http-429, slow, network or empty.");
  const failures = only ? config.scenarios.filter((scenario) => scenario.id === only) : config.scenarios;
  if (only && only !== "baseline" && failures.length === 0) throw new Error("Selected scenario is not configured.");
  return [{ id: "baseline", ...config.baseline }, ...failures];
}

export function matchesApi(url: string, config: { pathname: string; method?: string }): boolean {
  const pattern = config.pathname.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${pattern}$`).test(new URL(url).pathname);
}
