import { z } from "zod";

export type JsonFixture = null | boolean | number | string | JsonFixture[] | { [key: string]: JsonFixture };

// Konfiguracja TS pozostaje zaufanym kodem. Ta granica dotyczy deklaratywnych danych.
function isJsonFixture(value: unknown): value is JsonFixture {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let entries = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++entries > 5000 || current.depth > 12) return false;
    if (current.value === null || typeof current.value === "boolean") continue;
    if (typeof current.value === "number") { if (!Number.isFinite(current.value)) return false; continue; }
    if (typeof current.value === "string") { if (current.value.length > 32_000) return false; continue; }
    if (typeof current.value !== "object" || seen.has(current.value)) return false;
    seen.add(current.value);
    if (!Array.isArray(current.value) && Object.getPrototypeOf(current.value) !== Object.prototype && Object.getPrototypeOf(current.value) !== null) return false;
    for (const item of Object.values(current.value)) pending.push({ value: item, depth: current.depth + 1 });
  }
  try { return JSON.stringify(value).length <= 64_000; } catch { return false; }
}

export function normalizeOrigin(value: string): string | undefined {
  try {
    if (!/^https?:\/\//i.test(value) || /[\s\\\x7f]/.test(value)) return undefined;
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.hostname.includes("*") || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.origin === "null") return undefined;
    return url.origin;
  } catch { return undefined; }
}

export function isLoopbackOrigin(value: string): boolean {
  const origin = normalizeOrigin(value);
  if (!origin) return false;
  const hostname = new URL(origin).hostname;
  return hostname === "localhost" || hostname === "[::1]" || /^127\.(\d{1,3}\.){2}\d{1,3}$/.test(hostname);
}

export const originSchema = z.string().min(1).max(300).refine((value) => normalizeOrigin(value) !== undefined, "Use an exact HTTP(S) origin without credentials, path, query, fragment or wildcard.").transform((value) => normalizeOrigin(value)!);

export function isSafePathname(value: string): boolean {
  if (!/^\/[a-zA-Z0-9_/.%~*-]*$/.test(value) || value.startsWith("//")) return false;
  if (value.includes("*") && (!value.endsWith("/*") || value.slice(0, -1).includes("*"))) return false;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.includes("\\") || /[\x00-\x20?#]/.test(decoded)) return false;
    if (decoded.split("/").some((part) => part === "." || part === "..")) return false;
    if (/%(?:2f|5c)/i.test(value)) return false;
    return new URL(value, "http://localhost").pathname === value;
  } catch { return false; }
}

export const pathnameSchema = z.string().min(1).max(300).refine(isSafePathname, "Use an exact root-relative pathname or one trailing /*; encoded separators and dot segments are not supported.");
export const httpMethodSchema = z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
export const querySchema = z.record(z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.-]+$/), z.string().max(500)).refine((query) => Object.keys(query).length <= 20, "Use at most 20 exact query conditions.");
export const endpointMatcherSchema = z.object({ origin: originSchema.optional(), pathname: pathnameSchema, method: httpMethodSchema.default("GET"), query: querySchema.optional() }).strict();
export type EndpointMatcher = z.infer<typeof endpointMatcherSchema>;

export const jsonFixtureSchema = z.custom<JsonFixture>(isJsonFixture, "Use finite JSON fixture data, at most 64 KB, 5000 values and 12 levels deep; no functions or circular references.");
export const mockResponseSchema = z.object({ type: z.literal("mock"), status: z.number().int().min(200).max(299).refine((status) => status !== 204 && status !== 205, "JSON mocks require a response status that permits a body.").default(200), json: jsonFixtureSchema }).strict();
export const forwardResponseSchema = z.object({ type: z.literal("forward") }).strict();
export const responseSchema = z.discriminatedUnion("type", [mockResponseSchema, forwardResponseSchema]);
export const sequenceResponseSchema = z.discriminatedUnion("type", [
  mockResponseSchema,
  forwardResponseSchema,
  z.object({ type: z.literal("http-500") }).strict(),
  z.object({ type: z.literal("http-429"), retryAfterSeconds: z.number().int().min(1).max(300).default(1) }).strict(),
  z.object({ type: z.literal("network") }).strict(),
  z.object({ type: z.literal("empty") }).strict(),
  z.object({ type: z.literal("slow"), delayMs: z.number().int().min(500).max(10_000), response: responseSchema }).strict(),
]);
export type SequenceResponse = z.infer<typeof sequenceResponseSchema>;

export const endpointSchema = z.object({
  id: z.string().min(1).max(60).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  match: endpointMatcherSchema,
  response: responseSchema,
  expectedRequests: z.number().int().min(1).max(30).default(1),
  maxRequests: z.number().int().min(1).max(30).default(10),
  format: z.enum(["json", "supabase-rest"]).default("json"),
}).strict().superRefine((endpoint, ctx) => {
  if (endpoint.expectedRequests > endpoint.maxRequests) ctx.addIssue({ code: "custom", path: ["expectedRequests"], message: "Expected requests must not exceed maxRequests." });
  if (endpoint.format === "supabase-rest" && endpoint.match.method !== "GET") ctx.addIssue({ code: "custom", path: ["match", "method"], message: "Supabase REST support is limited to browser GET collection requests." });
  if (endpoint.format === "supabase-rest" && endpoint.response.type === "mock" && !Array.isArray(endpoint.response.json)) ctx.addIssue({ code: "custom", path: ["response", "json"], message: "Supabase REST collection mocks require a JSON array." });
});
export const endpointsSchema = z.array(endpointSchema).min(1).max(10).refine((endpoints) => new Set(endpoints.map((endpoint) => endpoint.id)).size === endpoints.length, "Endpoint IDs must be unique.");
export type EndpointDefinition = z.infer<typeof endpointSchema>;

export const targetOverrideSchema = z.object({ id: endpointSchema.shape.id, sequence: z.array(sequenceResponseSchema).min(1).max(30), expectedRequests: z.number().int().min(1).max(30) }).strict().refine((target) => target.expectedRequests === target.sequence.length, "Expected requests must equal the bounded response sequence length.");
export const targetOverridesSchema = z.array(targetOverrideSchema).min(1).max(10).refine((targets) => new Set(targets.map((target) => target.id)).size === targets.length, "Target override IDs must be unique.");
export type TargetOverride = z.infer<typeof targetOverrideSchema>;

export const assetRuleSchema = z.object({ origin: originSchema, pathname: pathnameSchema, resourceTypes: z.array(z.enum(["stylesheet", "font", "image", "script"])).min(1).max(4).refine((items) => new Set(items).size === items.length, "Asset resource types must be unique.") }).strict();
export const networkPolicySchema = z.object({
  mockOrigins: z.array(originSchema).max(20).default([]),
  localOrigins: z.array(originSchema.refine(isLoopbackOrigin, "Forwarded API origins must be HTTP(S) loopback.")).max(20).default([]),
  assets: z.array(assetRuleSchema).max(20).default([]),
}).strict().default({ mockOrigins: [], localOrigins: [], assets: [] });
export type NetworkPolicy = z.infer<typeof networkPolicySchema>;
