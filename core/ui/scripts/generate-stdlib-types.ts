#!/usr/bin/env bun
/**
 * Bundle the real `@types/node` and `bun-types` ambient declarations into a
 * single JSON record so Monaco's TypeScript service can mount them as a
 * virtual filesystem. The user's inline-script editor uses these for
 * IntelliSense — `import { loadavg } from "node:os"` should autocomplete
 * because the actual upstream `os.d.ts` is reachable, not a hand-rolled
 * approximation.
 *
 * The result is keyed by virtual filesystem path so Monaco resolves
 * cross-file `/// <reference>` directives correctly:
 *
 *   {
 *     "node_modules/@types/node/index.d.ts": "...",
 *     "node_modules/@types/node/os.d.ts": "...",
 *     "node_modules/bun-types/index.d.ts": "...",
 *     ...
 *   }
 *
 * Run with `bun run generate:monaco-types` from `core/ui`. The output JSON
 * lives at `src/components/CodeEditor/generated/stdlib-types.json` and is
 * lazy-imported by the editor (so the ~3 MB payload is code-split into its
 * own chunk and never blocks initial page load).
 *
 * It ALSO emits `generated/builtin-modules.json`: the authoritative list of
 * importable built-in specifiers (`node:fs`, bare `fs`, `bun`, `bun:test`, ...)
 * derived from the SAME bundled declarations (every importable built-in is a
 * top-level `declare module "<spec>"`). The editor ships this so the
 * import-name completion provider can suggest sandbox built-ins regardless of
 * the installed-package allowlist, and it auto-updates with the bundled types.
 */
import { createRequire } from "node:module";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractBuiltinModuleSpecifiers } from "../src/components/CodeEditor/importSpecifiers";

const require = createRequire(import.meta.url);

async function walkDts(
  dir: string,
  pathPrefix: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(dir, abs);
    const virtualPath = `${pathPrefix}/${rel}`;
    if (entry.isDirectory()) {
      Object.assign(out, await walkDts(abs, virtualPath));
    } else if (entry.name.endsWith(".d.ts")) {
      out[virtualPath] = await readFile(abs, "utf8");
    }
  }
  return out;
}

async function bundle(pkg: string, virtualPrefix: string) {
  const pkgJsonPath = require.resolve(`${pkg}/package.json`);
  const pkgRoot = path.dirname(pkgJsonPath);
  console.log(`  • ${pkg} ← ${pkgRoot}`);
  return walkDts(pkgRoot, virtualPrefix);
}

console.log("📦 Bundling Monaco stdlib types...");

// Build the file map immutably, then merge — eslint's
// `unicorn/no-immediate-mutation` flags `Object.assign(literal, ...)`.
const nodeFiles = await bundle("@types/node", "node_modules/@types/node");
const bunFiles = await bundle("bun-types", "node_modules/bun-types");

const files: Record<string, string> = {
  ...nodeFiles,
  ...bunFiles,
  // `@types/bun` is just a one-line wrapper that triple-slash-references
  // bun-types. Inline it so consumers can `import "bun"` and have Monaco
  // resolve it without needing the wrapper package.
  "node_modules/@types/bun/index.d.ts": `/// <reference types="bun-types" />\n`,
};

const outDir = path.join(
  import.meta.dir,
  "..",
  "src",
  "components",
  "CodeEditor",
  "generated",
);
const outFile = path.join(outDir, "stdlib-types.json");

await mkdir(outDir, { recursive: true });
// Compact JSON — this is consumed by code, not humans.
await writeFile(outFile, JSON.stringify(files), "utf8");

const totalBytes = Object.values(files).reduce((acc, c) => acc + c.length, 0);
console.log(
  `✅ Wrote ${Object.keys(files).length} files (${(totalBytes / 1024 / 1024).toFixed(2)} MB) → ${path.relative(process.cwd(), outFile)}`,
);

// Derive the authoritative built-in import specifier list from the SAME
// bundled declarations: every importable built-in (`node:fs`, bare `fs`,
// `bun`, `bun:test`, ...) is a top-level `declare module "<spec>"`, so the
// name set falls out of the d.ts text directly. Wildcard/asset-glob shims
// (`*.txt`, `*/bun.lock`) are filtered out by the extractor. This auto-updates
// whenever the bundled `@types/node` / `bun-types` are regenerated, so the
// editor's import-name completions never drift from the runtime stdlib.
const allDeclarations = Object.values(files).join("\n");
const builtinModules = extractBuiltinModuleSpecifiers(allDeclarations);
const builtinsFile = path.join(outDir, "builtin-modules.json");
await writeFile(builtinsFile, JSON.stringify(builtinModules), "utf8");
console.log(
  `✅ Wrote ${builtinModules.length} built-in module specifiers → ${path.relative(process.cwd(), builtinsFile)}`,
);
