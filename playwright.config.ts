import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 5_000 },
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3000", headless: true, viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000/demo",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
