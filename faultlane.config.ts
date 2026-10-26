import { defineConfig } from "./src/runner/config";

export default defineConfig({
  baseUrl: "http://127.0.0.1:3000",
  pagePath: "/demo",
  api: { pathname: "/api/demo/projects", method: "GET" },
  reportsDir: "reports",
  baseline: { assertions: [
    { testId: "projects", state: "text", text: "Atlas API" },
    { testId: "project", state: "count", count: 3 },
    { testId: "loading", state: "hidden" },
    { testId: "error", state: "hidden" },
  ] },
  scenarios: [
    { id: "http-500", assertions: [
      { testId: "server", state: "text", text: "couldn’t load your projects" },
      { testId: "retry", state: "visible" },
      { testId: "loading", state: "hidden" },
    ] },
    { id: "http-429", retryAfterSeconds: 30, assertions: [
      { testId: "rate-limit", state: "text", text: "Too many requests" },
      { testId: "retry", state: "visible" },
      { testId: "loading", state: "hidden" },
    ] },
    { id: "slow", delayMs: 3000, duringDelay: [
      { testId: "loading", state: "visible" },
    ], assertions: [
      { testId: "projects", state: "text", text: "Atlas API" },
      { testId: "loading", state: "hidden" },
      { testId: "error", state: "hidden" },
    ] },
    { id: "network", assertions: [
      { testId: "network", state: "text", text: "Connection interrupted" },
      { testId: "retry", state: "visible" },
      { testId: "loading", state: "hidden" },
    ] },
    { id: "empty", assertions: [
      { testId: "empty", state: "text", text: "No projects yet" },
      { testId: "error", state: "hidden" },
      { testId: "loading", state: "hidden" },
    ] },
  ],
});
