import { defineConfig } from "./src/runner/config";

export default defineConfig({
  name: "Cedar inventory · independent app recovery",
  baseUrl: "http://127.0.0.1:3100",
  pagePath: "/catalog",
  api: { pathname: "/api/inventory", method: "GET" },
  maxRequests: 2,
  actions: [
    { type: "navigate", path: "/catalog" },
    { type: "fill", locator: { by: "label", value: "Category" }, value: "stationery" },
    { type: "assert", assertion: { locator: { by: "role", role: "button", name: "Search inventory" }, state: "visible" } },
    { type: "click", locator: { by: "role", role: "button", name: "Search inventory" } },
    { type: "waitForRequest", request: { pathname: "/api/inventory", method: "GET" }, occurrence: 1 },
  ],
  baseline: { assertions: [
    { locator: { by: "role", role: "region", name: "Inventory results" }, state: "text", text: "Cedar notebook" },
    { locator: { by: "role", role: "alert", name: "Inventory problem" }, state: "hidden" },
  ] },
  scenarios: [{ id: "http-500", name: "Inventory error → Try again → items", affectRequests: 1, assertions: [
    { locator: { by: "role", role: "alert", name: "Inventory problem" }, state: "text", text: "Inventory is unavailable" },
    { locator: { by: "role", role: "button", name: "Try again" }, state: "visible" },
  ], recovery: {
    actions: [{ type: "click", locator: { by: "role", role: "button", name: "Try again" } }],
    assertions: [
      { locator: { by: "role", role: "region", name: "Inventory results" }, state: "text", text: "Cedar notebook" },
      { locator: { by: "role", role: "alert", name: "Inventory problem" }, state: "hidden" },
      { locator: { by: "role", role: "status", name: "Catalog loading" }, state: "hidden" },
    ],
  } }],
});
