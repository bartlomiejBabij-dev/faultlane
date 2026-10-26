import { z } from "zod";
import { scenarioIdSchema } from "./config";

export const statusSchema = z.enum(["PASS", "FAIL", "ERROR"]);
export type Status = z.infer<typeof statusSchema>;
export const runIdPattern = /^\d{8}T\d{9}Z-[a-f0-9]{8}$/;
export const assertionResultSchema = z.object({ expected: z.string().max(600), observed: z.string().max(1000), passed: z.boolean(), phase: z.enum(["during-delay", "after-response"]) });
export type AssertionResult = z.infer<typeof assertionResultSchema>;
export const scenarioResultSchema = z.object({
  id: scenarioIdSchema,
  status: statusSchema,
  durationMs: z.number().nonnegative(),
  interceptedRequests: z.number().int().nonnegative(),
  assertions: z.array(assertionResultSchema).max(40),
  observation: z.string().max(2000),
  suggestion: z.string().max(1000),
  screenshot: z.string().regex(/^(baseline|http-500|http-429|slow|network|empty)(-failure)?\.png$/).nullable(),
  loadingScreenshot: z.literal("slow-loading.png").nullable(),
  diagnostics: z.array(z.string().max(500)).max(10),
});
export type ScenarioResult = z.infer<typeof scenarioResultSchema>;
export const runResultSchema = z.object({
  schemaVersion: z.literal(1),
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
