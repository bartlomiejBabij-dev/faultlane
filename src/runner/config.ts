import { z } from "zod";

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

const testId = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const assertionSchema = z.discriminatedUnion("state", [
  z.object({ testId, state: z.literal("visible") }).strict(),
  z.object({ testId, state: z.literal("hidden") }).strict(),
  z.object({ testId, state: z.literal("text"), text: z.string().min(1).max(300) }).strict(),
  z.object({ testId, state: z.literal("count"), count: z.number().int().min(0).max(1000) }).strict(),
]);
export type Assertion = z.infer<typeof assertionSchema>;
const assertions = z.array(assertionSchema).min(1).max(20).refine(
  (items) => items.some((item) => item.state === "visible" || item.state === "text" || (item.state === "count" && item.count > 0)),
  "Include at least one positive assertion (visible, text, or count > 0).",
);
const failureSchema = z.discriminatedUnion("id", [
  z.object({ id: z.literal("http-500"), assertions }).strict(),
  z.object({ id: z.literal("http-429"), retryAfterSeconds: z.number().int().min(1).max(300).default(30), assertions }).strict(),
  z.object({ id: z.literal("slow"), delayMs: z.number().int().min(500).max(10_000).default(3000), duringDelay: assertions, assertions }).strict(),
  z.object({ id: z.literal("network"), assertions }).strict(),
  z.object({ id: z.literal("empty"), assertions }).strict(),
]);
export const configSchema = z.object({
  baseUrl: z.string().url().refine(isLoopbackUrl, "Only HTTP(S) localhost or loopback URLs are allowed.").refine((s) => { try { const u = new URL(s); return u.pathname === "/" && !u.search && !u.hash; } catch { return false; } }, "baseUrl must be an origin without a path, query or fragment."),
  pagePath: z.string().min(1).max(500).refine((s) => s.startsWith("/") && !s.startsWith("//") && !s.includes("\\") && !/[\x00-\x20]/.test(s), "Use a root-relative page path."),
  api: z.object({ pathname: z.string().min(2).max(300).regex(/^\/[a-zA-Z0-9_/*.%~-]+$/, "Use an API pathname with optional * wildcards; queries are ignored."), method: z.literal("GET").default("GET") }).strict(),
  baseline: z.object({ assertions }).strict(),
  scenarios: z.array(failureSchema).min(1).max(5).refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Scenario IDs must be unique."),
  timeouts: z.object({ navigationMs: z.number().int().min(500).max(60_000).default(20_000), requestMs: z.number().int().min(500).max(30_000).default(10_000), assertionMs: z.number().int().min(100).max(15_000).default(4000), scenarioMs: z.number().int().min(2000).max(120_000).default(45_000) }).strict().default({ navigationMs: 20_000, requestMs: 10_000, assertionMs: 4000, scenarioMs: 45_000 }),
  reportsDir: z.string().min(1).max(240).default("reports"),
  maskTestIds: z.array(testId).max(30).default([]),
}).strict().superRefine((config, ctx) => {
  if (!isLoopbackUrl(config.baseUrl)) return;
  if (!isLoopbackUrl(new URL(config.pagePath, config.baseUrl).href)) ctx.addIssue({ code: "custom", path: ["pagePath"], message: "Page must remain on loopback." });
  for (const [index, scenario] of config.scenarios.entries()) {
    if (scenario.id === "slow" && scenario.delayMs + config.timeouts.requestMs >= config.timeouts.scenarioMs) ctx.addIssue({ code: "custom", path: ["scenarios", index], message: "Scenario timeout must exceed delay plus request timeout." });
  }
});
export type FaultLaneConfig = z.infer<typeof configSchema>;
export type FaultLaneConfigInput = z.input<typeof configSchema>;
export type FailureScenario = FaultLaneConfig["scenarios"][number];
export type Scenario = FailureScenario | { id: "baseline"; assertions: Assertion[] };
export function defineConfig(config: FaultLaneConfigInput): FaultLaneConfig { return configSchema.parse(config); }

export function selectScenarios(config: FaultLaneConfig, only?: string): Scenario[] {
  if (only && !scenarioIdSchema.safeParse(only).success) throw new Error("Unknown scenario. Use baseline, http-500, http-429, slow, network or empty.");
  const failures = only ? config.scenarios.filter((scenario) => scenario.id === only) : config.scenarios;
  if (only && only !== "baseline" && failures.length === 0) throw new Error("Selected scenario is not configured.");
  return [{ id: "baseline", ...config.baseline }, ...failures];
}

export function matchesApi(url: string, config: FaultLaneConfig["api"]): boolean {
  const pattern = config.pathname.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${pattern}$`).test(new URL(url).pathname);
}
