import { build } from "esbuild";
import { chmod, lstat, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const root = await realpath(fileURLToPath(new URL("..", import.meta.url)));
const outdir = path.resolve(root, "dist");
if (path.dirname(outdir) !== root || path.basename(outdir) !== "dist") throw new Error("Invalid build output directory");
const previous = await lstat(outdir).catch((error) => { if (error.code !== "ENOENT") throw error; });
if (previous?.isSymbolicLink()) throw new Error("Build output must not be a symlink");
// Delete only this project's verified generated directory, never source or reports.
await rm(outdir, { recursive: true, force: true });
await build({ absWorkingDir: root, entryPoints: ["src/runner/cli.ts", "src/runner/config.ts"], outdir, bundle: true, splitting: true, platform: "node", format: "esm", target: "node22", packages: "external", define: { FAULTLANE_VERSION: JSON.stringify(pkg.version) }, sourcemap: false });
await chmod(path.join(outdir, "cli.js"), 0o755);
const configFile = ts.readConfigFile(path.join(root, "tsconfig.cli.json"), ts.sys.readFile);
if (configFile.error) throw new Error("Could not read CLI TypeScript configuration");
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
// The dashboard source uses bundler resolution; emitted ESM declarations need .js.
// Apply this only to the compiler's declaration AST, not to the shared source.
const extensions = (context) => (source) => {
  const visit = (node) => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      const specifier = node.argument.literal.text;
      if (specifier.startsWith(".") && !path.extname(specifier)) {
        return ts.factory.updateImportTypeNode(node, ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(specifier + ".js")), node.attributes, node.qualifier, node.typeArguments, node.isTypeOf);
      }
    }
    if ((ts.isExportDeclaration(node) || ts.isImportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith(".") && !path.extname(specifier)) {
        const replacement = ts.factory.createStringLiteral(specifier + ".js");
        return ts.isExportDeclaration(node)
          ? ts.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, replacement, node.attributes)
          : ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause, replacement, node.attributes);
      }
    }
    return ts.visitEachChild(node, visit, context);
  };
  return ts.visitNode(source, visit);
};
const emitted = program.emit(undefined, undefined, undefined, true, { afterDeclarations: [extensions] });
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics];
if (diagnostics.some((item) => item.category === ts.DiagnosticCategory.Error)) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: (file) => file, getCurrentDirectory: () => root, getNewLine: () => "\n" }));
console.log(`Built FaultLane ${pkg.version} CLI.`);
