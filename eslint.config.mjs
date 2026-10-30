import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Niezależne fixture Vite nie używają next/image. Zwykły img testuje
  // precyzyjne zezwolenie na zewnętrzny zasób typu image.
  { files: ["examples/react-board/**/*.tsx", "examples/supabase-tasks/**/*.tsx"], rules: { "@next/next/no-img-element": "off" } },
  globalIgnores([".next/**", "reports/**", "test-results/**", "playwright-report/**", "next-env.d.ts", "dist/**", ".package-tests/**", "examples/**/.next/**", "examples/**/next-env.d.ts"]),
]);
