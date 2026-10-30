import { z } from "zod";
import { scenarioIdSchema } from "./config";

export const statusSchema = z.enum(["PASS", "FAIL", "ERROR"]);
export type Status = z.infer<typeof statusSchema>;
export const runIdPattern = /^\d{8}T\d{9}Z-[a-f0-9]{8}$/;
export const assertionResultSchema = z.object({ expected: z.string().max(1000), observed: z.string().max(1500), passed: z.boolean(), phase: z.enum(["during-delay", "after-response", "action", "recovery"]) });
export type AssertionResult = z.infer<typeof assertionResultSchema>;
export const evidencePattern = /^(baseline|http-500|http-429|slow|network|empty)(-failure|-loading|-step-\d{3})?\.png$/;
const evidenceStatusSchema = z.enum(["SAVED", "SKIPPED", "FAILED"]);
export const evidenceStateSchema = z.object({ status: evidenceStatusSchema, captureStatus: evidenceStatusSchema.optional(), persistenceStatus: evidenceStatusSchema.optional(), failures: z.array(z.string().max(200)).max(20) }).strict();
export const stepResultSchema = z.object({ index: z.number().int().min(1).max(300), phase: z.enum(["setup", "action", "fault", "recovery"]), expected: z.string().max(1000), observed: z.string().max(1500), status: z.enum(["PASS", "FAIL", "ERROR", "SKIPPED"]), durationMs: z.number().nonnegative(), screenshot: z.string().regex(evidencePattern).nullable(), code: z.string().max(80).nullable() });
export type StepResult = z.infer<typeof stepResultSchema>;
export const requestResultSchema = z.object({ ordinal: z.number().int().positive(), phase: z.enum(["fault", "recovery", "baseline"]), outcome: z.enum(["pending", "simulated", "forwarded", "aborted", "blocked", "error"]), status: z.number().int().min(100).max(599).nullable() });
export type RequestResult = z.infer<typeof requestResultSchema>;
const requestCountSchema = z.number().int().nonnegative();
const queryKeysSchema = z.array(z.string().max(64).regex(/^(?:[a-zA-Z_][a-zA-Z0-9_.[\]-]{0,63}|\[redacted-key\])$/)).max(30);
const safeOriginSchema = z.string().max(300).refine((value) => {
  if (["[non-http]", "[invalid URL]"].includes(value)) return true;
  try { const url = new URL(value); return ["http:", "https:", "ws:", "wss:"].includes(url.protocol) && url.origin === value; } catch { return false; }
}, "Network evidence requires an origin without credentials, path or query.");
const safePathnameSchema = z.string().max(500).refine((value) => !/[?#\u0000-\u001f\u007f]/.test(value), "Network evidence paths must omit query values and fragments.");
const methodSchema = z.string().regex(/^[A-Z]{1,20}$/);
const metadataSchema = z.object({ origin: safeOriginSchema, pathname: safePathnameSchema, queryKeys: queryKeysSchema, method: methodSchema, resourceType: z.string().regex(/^[a-z-]{1,30}$/) });
export const endpointRequestResultSchema = z.object({
  ordinal: z.number().int().positive(), phase: z.enum(["baseline", "fault", "recovery"]),
  outcome: z.enum(["pending", "simulated", "mocked", "forwarded", "aborted", "blocked", "error"]),
  status: z.number().int().min(100).max(599).nullable(), fault: z.boolean(),
}).strict();
export type EndpointRequestResult = z.infer<typeof endpointRequestResultSchema>;
export const endpointResultSchema = z.object({
  id: z.string().min(1).max(100), origin: safeOriginSchema, method: methodSchema, pathname: safePathnameSchema, queryKeys: queryKeysSchema,
  expectedRequests: z.number().int().min(1).max(30), maxRequests: z.number().int().min(1).max(30),
  observedRequests: requestCountSchema, interceptedRequests: requestCountSchema, blockedRequests: requestCountSchema, faultedRequests: requestCountSchema,
  expectedSequence: z.array(z.object({ ordinal: z.number().int().min(1).max(30), action: z.string().max(100), status: z.number().int().min(100).max(599).nullable(), delayMs: z.number().nonnegative().optional() }).strict()).min(1).max(30),
  requests: z.array(endpointRequestResultSchema).max(31),
}).strict();
export type EndpointResult = z.infer<typeof endpointResultSchema>;
export const networkEventSchema = metadataSchema.extend({
  decision: z.enum(["observed", "mocked", "forwarded", "blocked", "preflight", "allowed-asset"]), endpointId: z.string().max(100).optional(),
}).strict();
export type NetworkEvent = z.infer<typeof networkEventSchema>;
export const networkSummarySchema = z.object({
  policy: z.literal("explicit-origins"), observedRequests: requestCountSchema, blockedRequests: requestCountSchema, allowedRequests: requestCountSchema, mockedRequests: requestCountSchema,
  events: z.array(networkEventSchema).max(200), truncated: z.boolean(), zeroMatchTargets: z.array(z.string().max(100)).max(20),
  warnings: z.array(z.string().max(500)).max(20), hypotheses: z.array(z.string().max(500)).max(20), nextActions: z.array(z.string().max(500)).max(20),
}).strict();
export type NetworkSummary = z.infer<typeof networkSummarySchema>;
export const scenarioResultSchema = z.object({
  id: scenarioIdSchema,
  status: statusSchema,
  durationMs: z.number().nonnegative(),
  interceptedRequests: z.number().int().nonnegative(),
  observedRequests: z.number().int().nonnegative().optional(),
  faultedRequests: z.number().int().nonnegative().optional(),
  requests: z.array(requestResultSchema).max(31).optional(),
  name: z.string().max(100).optional(),
  code: z.string().max(80).nullable().optional(),
  steps: z.array(stepResultSchema).max(300).optional(),
  failedStep: z.number().int().positive().nullable().optional(),
  assertions: z.array(assertionResultSchema).max(120),
  observation: z.string().max(2000),
  suggestion: z.string().max(1000),
  screenshot: z.string().regex(evidencePattern).nullable(),
  loadingScreenshot: z.literal("slow-loading.png").nullable(),
  diagnostics: z.array(z.string().max(500)).max(10),
  evidence: evidenceStateSchema.optional(),
  identity: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  endpoints: z.array(endpointResultSchema).min(1).max(20).optional(),
  network: networkSummarySchema.optional(),
});
export type ScenarioResult = z.infer<typeof scenarioResultSchema>;
export const runResultSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  publicationProtocol: z.literal("pending-marker-v1").optional(),
  name: z.string().max(100).optional(),
  id: z.string().regex(runIdPattern),
  startedAt: z.string().datetime(),
  durationMs: z.number().nonnegative(),
  application: z.string().max(600),
  apiPattern: z.string().max(300),
  results: z.array(scenarioResultSchema).min(1).max(6),
}).superRefine((run, context) => {
  if (run.schemaVersion !== 3) return;
  for (const [index, result] of run.results.entries()) {
    if (!result.endpoints || !result.network) context.addIssue({ code: "custom", path: ["results", index], message: "Schema version 3 requires endpoint and network evidence for every scenario." });
  }
});
export type RunResult = z.infer<typeof runResultSchema>;
export function exitCode(results: (Pick<ScenarioResult, "status"> & Partial<Pick<ScenarioResult, "evidence">>)[]): 0 | 1 | 2 {
  if (results.length === 0 || results.some((result) => result.status === "ERROR" || (result.evidence !== undefined && result.evidence.status !== "SAVED"))) return 2;
  return results.some((result) => result.status === "FAIL") ? 1 : 0;
}
export function summarize(results: Pick<ScenarioResult, "status">[]) {
  return { pass: results.filter((r) => r.status === "PASS").length, fail: results.filter((r) => r.status === "FAIL").length, error: results.filter((r) => r.status === "ERROR").length };
}
