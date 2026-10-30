import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";
import { stopFixtureProcess } from "../../scripts/fixture-process";

it("stops its own synthetic fixture process within the cleanup deadline", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true, detached: process.platform !== "win32" });
  await once(child, "spawn");
  try {
    await stopFixtureProcess(child);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  } finally { await stopFixtureProcess(child); }
}, 20_000);
