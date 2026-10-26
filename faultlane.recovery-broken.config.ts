import recovery from "./faultlane.recovery.config";
import { defineConfig } from "./src/runner/config";

// Only these explicit synthetic defects can be selected. No arbitrary code/URL input.
const bug = process.env.FAULTLANE_DEMO_BUG ?? "retry-no-request";
if (!["retry-no-request", "recovery-error", "recovery-loading"].includes(bug)) throw new Error("Unknown demo defect");
export default defineConfig({ ...recovery, name: `Intentional recovery defect · ${bug}`, pagePath: `/demo?mode=manual&broken=${bug}` });
