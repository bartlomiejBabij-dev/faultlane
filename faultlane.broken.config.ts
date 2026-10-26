import config from "./faultlane.config";
import { defineConfig } from "./src/runner/config";

// Explicit demo-only switch. The default configuration never enables the defect.
export default defineConfig({ ...config, pagePath: "/demo?broken=http-500", scenarios: config.scenarios.filter((scenario) => scenario.id === "http-500") });
