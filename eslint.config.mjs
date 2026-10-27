import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "reports/**", "test-results/**", "playwright-report/**", "next-env.d.ts", "dist/**", ".package-tests/**", "examples/**/.next/**", "examples/**/next-env.d.ts"]),
]);
