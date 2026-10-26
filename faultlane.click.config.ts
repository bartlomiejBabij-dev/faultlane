import original from "./faultlane.config";
import { defineConfig } from "./src/runner/config";

export default defineConfig({
  ...original,
  name: "Projects · load by click · HTTP 500",
  pagePath: "/demo?mode=manual",
  maxRequests: 2,
  actions: [
    { type: "waitForElement", locator: { by: "role", role: "button", name: "Load Projects" }, state: "visible" },
    { type: "click", locator: { by: "role", role: "button", name: "Load Projects" } },
    { type: "waitForRequest", request: { pathname: "/api/demo/projects", method: "GET" }, occurrence: 1 },
  ],
  scenarios: [{ id: "http-500", name: "Load Projects shows an actionable server error", affectRequests: 1, assertions: [
    { locator: { by: "role", role: "alert", name: "Project error" }, state: "text", text: "couldn’t load your projects" },
    { locator: { by: "role", role: "button", name: "Retry" }, state: "visible" },
    { testId: "loading", state: "hidden" },
  ] }],
});

