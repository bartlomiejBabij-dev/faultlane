import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const injected = vi.hoisted(() => ({ partial: false, denied: false }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    if (injected.denied) { const error = new Error("synthetic permission failure") as NodeJS.ErrnoException; error.code = "EACCES"; throw error; }
    const handle = await fs.open(...args);
    if (!injected.partial) return handle;
    return new Proxy(handle, { get(target, property) {
      if (property === "writeFile") return async (data: Buffer) => {
        await target.writeFile(data.subarray(0, 2));
        const error = new Error("synthetic disk interruption") as NodeJS.ErrnoException; error.code = "EIO"; throw error;
      };
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    } });
  } };
});
import { writeExclusiveFile } from "../../src/runner/evidence";

const dirs: string[] = [];
afterEach(async () => { injected.partial = false; injected.denied = false; await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
it("removes an interrupted partial write and does not publish a destination", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "faultlane-interruption-")); dirs.push(dir);
  injected.partial = true;
  await expect(writeExclusiveFile(path.join(dir, "results.json"), Buffer.from("content"))).rejects.toThrow("write: EIO");
  expect(await readdir(dir)).toEqual([]);
});
it("reports a denied destination without requiring administrator privileges", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "faultlane-denied-")); dirs.push(dir);
  injected.denied = true;
  await expect(writeExclusiveFile(path.join(dir, "shot.png"), Buffer.from("content"))).rejects.toThrow("temporary-create: EACCES");
  expect(await readdir(dir)).toEqual([]);
});
