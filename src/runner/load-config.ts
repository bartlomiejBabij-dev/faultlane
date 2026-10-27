import path from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import { configSchema, type FaultLaneConfig } from "./config";

export async function loadConfig(filename = "faultlane.config.ts", cwd = process.cwd()): Promise<FaultLaneConfig> {
  // This is executable local TypeScript. Never load a config from an untrusted source.
  const loaded: { default?: unknown } = await tsImport(pathToFileURL(path.resolve(cwd, filename)).href, import.meta.url);
  // tsx exposes CommonJS transpiled default exports through a second wrapper.
  const value = loaded.default;
  const config = value && typeof value === "object" && Object.keys(value).length === 1 && "default" in value ? value.default : value;
  return configSchema.parse(config);
}
