import path from "node:path";
import { pathToFileURL } from "node:url";
import { configSchema, type FaultLaneConfig } from "./config";

export async function loadConfig(filename = "faultlane.config.ts"): Promise<FaultLaneConfig> {
  // This is executable local TypeScript. Never load a config from an untrusted source.
  const loaded: { default?: unknown } = await import(pathToFileURL(path.resolve(filename)).href);
  return configSchema.parse(loaded.default);
}
