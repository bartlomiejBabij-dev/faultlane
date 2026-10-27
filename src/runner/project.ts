import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";

export type ProjectInfo = { framework: "Next.js" | "Vite" | "React" | "unknown"; scripts: string[]; suggestedUrl: string; packageFound: boolean };
export async function detectProject(cwd: string): Promise<ProjectInfo> {
  const result: ProjectInfo = { framework: "unknown", scripts: [], suggestedUrl: "http://127.0.0.1:3000", packageFound: false };
  try {
    const filename = path.join(cwd, "package.json");
    if ((await stat(filename)).size > 1_000_000) return result;
    const schema = z.object({ dependencies: z.record(z.string(), z.unknown()).optional(), devDependencies: z.record(z.string(), z.unknown()).optional(), scripts: z.record(z.string(), z.unknown()).optional() });
    const pkg = schema.parse(JSON.parse(await readFile(filename, "utf8")));
    result.packageFound = true;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    result.framework = "next" in deps ? "Next.js" : "vite" in deps ? "Vite" : "react" in deps ? "React" : "unknown";
    result.scripts = ["dev", "start"].filter((key) => typeof pkg.scripts?.[key] === "string");
    if (result.framework === "Vite") result.suggestedUrl = "http://127.0.0.1:5173";
  } catch { /* Only read package.json; never source .env or execute scripts. */ }
  return result;
}
