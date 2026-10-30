import { z } from "zod";
import { endpointMatcherSchema } from "./endpoint-schema";

export const testIdSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const text = z.string().min(1).max(300);
export const pagePathSchema = z.string().min(1).max(500).refine((s) => s.startsWith("/") && !s.startsWith("//") && !s.includes("\\") && !/[\x00-\x20]/.test(s), "Use a root-relative local page path.");
export const apiSchema = z.object({ pathname: z.string().min(2).max(300).regex(/^\/[a-zA-Z0-9_/*.%~-]+$/, "Use an API pathname with optional * wildcards; queries are ignored."), method: z.literal("GET").default("GET") }).strict();
export const locatorSchema = z.discriminatedUnion("by", [
  z.object({ by: z.literal("testId"), value: testIdSchema }).strict(),
  z.object({ by: z.literal("label"), value: text }).strict(),
  z.object({ by: z.literal("role"), role: z.enum(["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "option", "heading", "alert", "status", "region", "list", "listitem", "table", "row", "cell", "dialog", "tab", "tabpanel", "progressbar", "img", "form", "navigation"]), name: text.optional() }).strict(),
]);
export type LocatorConfig = z.infer<typeof locatorSchema>;

const target = { testId: testIdSchema.optional(), locator: locatorSchema.optional() };
export const assertionSchema = z.discriminatedUnion("state", [
  z.object({ ...target, state: z.literal("visible") }).strict(),
  z.object({ ...target, state: z.literal("hidden") }).strict(),
  z.object({ ...target, state: z.literal("text"), text }).strict(),
  z.object({ ...target, state: z.literal("textAbsent"), text }).strict(),
  z.object({ ...target, state: z.literal("count"), count: z.number().int().min(0).max(1000) }).strict(),
]).refine((a) => Number(a.testId !== undefined) + Number(a.locator !== undefined) === 1, "Provide exactly one testId or locator.");
export type Assertion = z.infer<typeof assertionSchema>;
export const assertionsSchema = z.array(assertionSchema).min(1).max(20).refine(
  (items) => items.some((item) => item.state === "visible" || item.state === "text" || (item.state === "count" && item.count > 0)),
  "Include at least one positive assertion (visible, text, or count > 0).",
);
const timeoutMs = z.number().int().min(100).max(30_000).optional();
const actionFields = { timeoutMs };
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), path: pagePathSchema, ...actionFields }).strict(),
  z.object({ type: z.literal("click"), locator: locatorSchema, ...actionFields }).strict().refine((a) => a.locator.by !== "role" || !!a.locator.name, "Click by role requires an accessible name."),
  z.object({ type: z.literal("fill"), locator: locatorSchema, value: z.string().max(2000), ...actionFields }).strict(),
  z.object({ type: z.literal("waitForElement"), locator: locatorSchema, state: z.enum(["visible", "hidden"]).default("visible"), ...actionFields }).strict(),
  // The listener is armed before navigation. Occurrence is absolute within the scenario,
  // so a fast request between click and wait cannot be missed.
  z.object({ type: z.literal("waitForRequest"), request: z.union([apiSchema, endpointMatcherSchema]), occurrence: z.number().int().min(1).max(30).default(1), ...actionFields }).strict(),
  z.object({ type: z.literal("assert"), assertion: assertionSchema, ...actionFields }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export const actionsSchema = z.array(actionSchema).max(30);
export const recoverySchema = z.object({
  actions: actionsSchema.min(1).refine((actions) => actions[0]?.type === "click" && actions.slice(1).every((a) => ["assert", "waitForElement", "waitForRequest"].includes(a.type)), "Recovery starts with one click, followed only by assertions or waits."),
  assertions: assertionsSchema,
}).strict();
