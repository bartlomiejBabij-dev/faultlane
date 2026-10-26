import { z } from "zod";
import { scenarioIdSchema } from "./config";

export const statusSchema = z.enum(["PASS", "FAIL", "ERROR"]);
export type Status = z.infer<typeof statusSchema>;
export const runIdPattern = /^\d{8}T\d{9}Z-[a-f0-9]{8}$/;
export const assertionResultSchema = z.object({ expected: z.string().max(1000), observed: z.string().max(1500), passed: z.boolean(), phase: z.enum(["during-delay", "after-response", "action", "recovery"]) });
export type AssertionResult = z.infer<typeof assertionResultSchema>;
export const evidencePattern = /^(baseline|http-500|http-429|slow|network|empty)(-failure|-loading|-step-\d{3})?\.png$/;
export const stepResultSchema = z.object({ index: z.number().int().min(1).max(300), phase: z.enum(["setup", "action", "fault", "recovery"]), expected: z.string().max(1000), observed: z.string().max(1500), status: z.enum(["PASS", "FAIL", "ERROR", "SKIPPED"]), durationMs: z.number().nonnegative(), screenshot: z.string().regex(evidencePattern).nullable(), code: z.string().max(80).nullable() });
export type StepResult = z.infer<typeof stepResultSchema>;
export const requestResultSchema = z.object({ ordinal: z.number().int().positive(), phase: z.enum(["fault", "recovery", "baseline"]), outcome: z.enum(["pending", "simulated", "forwarded", "aborted", "blocked", "error"]), status: z.number().int().min(100).max(599).nullable() });
export type RequestResult = z.infer<typeof requestResultSchema>;
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
});
export type ScenarioResult = z.infer<typeof scenarioResultSchema>;
export const runResultSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  name: z.string().max(100).optional(),
  id: z.string().regex(runIdPattern),
  startedAt: z.string().datetime(),
  durationMs: z.number().nonnegative(),
  application: z.string().max(600),
  apiPattern: z.string().max(300),
  results: z.array(scenarioResultSchema).min(1).max(6),
});
export type RunResult = z.infer<typeof runResultSchema>;
export function exitCode(results: Pick<ScenarioResult, "status">[]): 0 | 1 | 2 {
  if (results.length === 0 || results.some((result) => result.status === "ERROR")) return 2;
  return results.some((result) => result.status === "FAIL") ? 1 : 0;
}
export function summarize(results: Pick<ScenarioResult, "status">[]) {
  return { pass: results.filter((r) => r.status === "PASS").length, fail: results.filter((r) => r.status === "FAIL").length, error: results.filter((r) => r.status === "ERROR").length };
}
