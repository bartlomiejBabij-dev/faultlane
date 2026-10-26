import click from "./faultlane.click.config";
import { defineConfig } from "./src/runner/config";

export default defineConfig({
  ...click,
  name: "Projects · HTTP 500 → Retry → recovery",
  timeouts: { ...click.timeouts, requestMs: 4000, assertionMs: 2000 },
  scenarios: [{
    ...click.scenarios[0]!,
    name: "One failed request followed by successful Retry",
    recovery: {
      actions: [
        { type: "click", locator: { by: "role", role: "button", name: "Retry" } },
        { type: "waitForRequest", request: { pathname: "/api/demo/projects", method: "GET" }, occurrence: 2 },
      ],
      assertions: [
        { locator: { by: "role", role: "alert", name: "Project error" }, state: "hidden" },
        { testId: "projects", state: "text", text: "Atlas API" },
        { testId: "loading", state: "hidden" },
        { testId: "error", state: "textAbsent", text: "couldn’t load" },
      ],
    },
  }],
});

