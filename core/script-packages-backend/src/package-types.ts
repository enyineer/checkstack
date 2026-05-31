import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { PackageTypeClosure } from "@checkstack/script-packages-common";

/**
 * Tree-driven `.d.ts` closure extractor for editor IntelliSense (Monaco
 * lazy Automatic Type Acquisition).
 *
 * Given a requested bare specifier (e.g. `lodash`) and the materialized
 * `node_modules` at `<storeRoot>/trees/<lockfileHash>/node_modules`, this
 * returns a FILE-MAP (`{ path, content }[]`) of the declaration closure,
 * preserving the real `node_modules/...` layout and leaving every file
 * UNWRAPPED (no `declare module` envelope). The frontend registers each
 * file at `file:///<path>` and lets TypeScript's own NodeJs + `@types`
 * resolution pick own-types vs. `@types` fallback.
 *
 * Resolution mirrors TypeScript's own, against the actual tree:
 *
 *   1. OWN types: `node_modules/<pkg>/package.json` `types`/`typings`/
 *      `exports[...]types`, falling back to `index.d.ts`. Included when
 *      the package ships its own declarations (e.g. `zod`, `dayjs`).
 *   2. `@types` COMPANION: the DefinitelyTyped dir name is computed by the
 *      mangling rule (`@scope/name` -> `@types/scope__name`, unscoped
 *      `lodash` -> `@types/lodash`) and included ONLY when it actually
 *      exists in the tree (e.g. `lodash` -> `@types/lodash`).
 *   3. Either, both, or neither may be present. Neither -> a graceful
 *      empty closure (`notFound`), never a throw: the editor simply gets
 *      no completions for that import.
 *
 * Triple-slash `/// <reference path|types=...>` directives and cross-file
 * relative `import`/`require` references are followed so multi-file packages
 * (lodash's ~700-file `/// <reference path>` web) resolve fully. Cross-
 * package `@types` references (a `@types` pkg referencing another) are
 * followed too. The whole walk is BOUNDED by `maxTotalBytes`; if anything
 * is dropped, `truncated` is set (NO silent caps).
 */

/** Default closure ceiling. Well above lodash's ~866 KB type set. */
const DEFAULT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;

interface CollectedFile {
  /** `node_modules/...`-relative path (the virtual editor path). */
  path: string;
  content: string;
}

/**
 * Map a bare package specifier to its DefinitelyTyped (`@types`) directory
 * name segment. Unscoped: `lodash` -> `lodash`. Scoped: `@scope/name` ->
 * `scope__name` (drop the leading `@`, replace `/` with `__`).
 *
 * Pure + exported for unit testing the mangling rule directly.
 */
export function typesPackageDirName(specifier: string): string {
  if (specifier.startsWith("@")) {
    const withoutAt = specifier.slice(1);
    return withoutAt.replace("/", "__");
  }
  return specifier;
}

interface ResolveClosureArgs {
  /** Absolute path to the materialized tree's `node_modules`. */
  nodeModulesDir: string;
  /** Requested bare specifier, e.g. `lodash` or `@babel/core`. */
  specifier: string;
  /** Total-byte ceiling for the whole closure. */
  maxTotalBytes?: number;
}

/**
 * Resolve the declaration-file closure for one requested specifier against
 * the materialized tree. Never throws on a missing package / file / dir;
 * returns a graceful empty (`notFound: true`) closure instead.
 */
export async function resolvePackageTypeClosure({
  nodeModulesDir,
  specifier,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
}: ResolveClosureArgs): Promise<PackageTypeClosure> {
  const collected = new Map<string, CollectedFile>();
  let totalBytes = 0;
  let truncated = false;

  // BFS over reference roots so the closure follows triple-slash + import
  // references. Each queue item is an ABSOLUTE file path to read; the queue
  // is seeded with the resolved entry points (own types + @types).
  const queue: string[] = [];
  const queuedOrDone = new Set<string>();

  const enqueue = (absFile: string): void => {
    if (queuedOrDone.has(absFile)) return;
    queuedOrDone.add(absFile);
    queue.push(absFile);
  };

  // Convert an absolute path inside the tree to its `node_modules/...`
  // virtual path. Returns undefined for paths outside the tree (defensive;
  // we never follow `..` past node_modules).
  const toVirtualPath = (absFile: string): string | undefined => {
    const rel = path.relative(nodeModulesDir, absFile);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
    // Always POSIX-style for the virtual editor URI.
    return `node_modules/${rel.split(path.sep).join("/")}`;
  };

  // ─── Seed: own types ──────────────────────────────────────────────────
  const pkgDir = path.join(nodeModulesDir, ...specifier.split("/"));
  const ownEntries = await resolveOwnTypeEntries(pkgDir);
  let hasOwnTypes = false;
  for (const entry of ownEntries) {
    hasOwnTypes = true;
    enqueue(entry);
  }
  // The package.json itself is part of the closure so NodeJs/@types
  // resolution can read `types`/`typings`/`exports`/`main`.
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (await fileExists(pkgJsonPath)) {
    enqueue(pkgJsonPath);
  }

  // ─── Seed: @types companion (existence-checked, never assumed) ────────
  const typesDir = path.join(
    nodeModulesDir,
    "@types",
    typesPackageDirName(specifier),
  );
  let hasAtTypes = false;
  if (await dirExists(typesDir)) {
    hasAtTypes = true;
    const typesPkgJson = path.join(typesDir, "package.json");
    if (await fileExists(typesPkgJson)) enqueue(typesPkgJson);
    // Walk ALL .d.ts under the @types dir (not just index): DefinitelyTyped
    // packages like lodash fan out across many files via /// <reference>.
    for (const dtsFile of await walkDtsFiles(typesDir)) {
      enqueue(dtsFile);
    }
  }

  // ─── BFS drain ────────────────────────────────────────────────────────
  while (queue.length > 0) {
    const absFile = queue.shift();
    if (absFile === undefined) break;
    const virtualPath = toVirtualPath(absFile);
    if (virtualPath === undefined) continue;
    if (collected.has(virtualPath)) continue;

    let content: string;
    try {
      content = await readFile(absFile, "utf8");
    } catch {
      continue; // Skip unreadable file; never fatal.
    }

    if (totalBytes + content.length > maxTotalBytes) {
      truncated = true;
      continue; // Drop this file (and stop following its refs) but keep going.
    }
    collected.set(virtualPath, { path: virtualPath, content });
    totalBytes += content.length;

    // Only declaration files carry references worth following.
    if (
      absFile.endsWith(".d.ts") ||
      absFile.endsWith(".d.mts") ||
      absFile.endsWith(".d.cts")
    ) {
      for (const ref of extractReferences(content)) {
        const resolved = await resolveReference({
          ref,
          fromFile: absFile,
          nodeModulesDir,
        });
        if (resolved) enqueue(resolved);
      }
    }
  }

  const files = [...collected.values()].toSorted((a, b) =>
    a.path.localeCompare(b.path),
  );

  return {
    specifier,
    files,
    hasOwnTypes,
    hasAtTypes,
    notFound: !hasOwnTypes && !hasAtTypes,
    truncated,
  };
}

// ─── Own-type entry resolution ────────────────────────────────────────────

/**
 * Resolve a package's own declaration entry point(s) from its
 * `package.json` (`types`/`typings`, `exports[...]types`), falling back to
 * `index.d.ts`. Returns absolute paths to existing files (possibly several
 * from an `exports` map). Empty when the package ships no own types.
 */
async function resolveOwnTypeEntries(pkgDir: string): Promise<string[]> {
  const out = new Set<string>();
  const pkgJsonPath = path.join(pkgDir, "package.json");

  let pkg: Record<string, unknown> | undefined;
  try {
    const raw = await readFile(pkgJsonPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object") {
      pkg = parsed as Record<string, unknown>;
    }
  } catch {
    pkg = undefined;
  }

  const addIfExists = async (rel: string): Promise<void> => {
    if (
      !rel.endsWith(".d.ts") &&
      !rel.endsWith(".d.mts") &&
      !rel.endsWith(".d.cts")
    ) {
      return;
    }
    const abs = path.join(pkgDir, rel);
    if (await fileExists(abs)) out.add(abs);
  };

  if (pkg) {
    const typesField = pkg.types ?? pkg.typings;
    if (typeof typesField === "string") {
      await addIfExists(typesField);
    }
    // `exports` map: collect every `types` condition (subpaths included).
    for (const rel of collectExportsTypes(pkg.exports)) {
      await addIfExists(rel);
    }
  }

  // Conventional fallback.
  if (out.size === 0) {
    const indexDts = path.join(pkgDir, "index.d.ts");
    if (await fileExists(indexDts)) out.add(indexDts);
  }

  return [...out];
}

/**
 * Recursively collect every `types`-condition target from an `exports`
 * map. Handles strings, nested condition objects, and subpath maps.
 */
function collectExportsTypes(exportsField: unknown): string[] {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (key === "types" && typeof value === "string") {
        out.push(value.replace(/^\.\//, ""));
      } else {
        visit(value);
      }
    }
  };
  visit(exportsField);
  return out;
}

// ─── Reference following ───────────────────────────────────────────────────

interface FileReference {
  kind: "path" | "types";
  target: string;
}

/**
 * Extract triple-slash references and relative module imports/requires from
 * a `.d.ts` body. `/// <reference path=...>` -> relative file; `/// <reference
 * types=...>` -> another package's `@types`; relative `import`/`require` /
 * `export ... from` -> a sibling declaration file.
 *
 * Pure + exported for unit testing.
 */
export function extractReferences(content: string): FileReference[] {
  const refs: FileReference[] = [];

  // Triple-slash references.
  const tripleSlash =
    /\/\/\/\s*<reference\s+(path|types)\s*=\s*["']([^"']+)["']\s*\/>/g;
  let m: RegExpExecArray | null = tripleSlash.exec(content);
  while (m !== null) {
    const kind = m[1] === "types" ? "types" : "path";
    refs.push({ kind, target: m[2] });
    m = tripleSlash.exec(content);
  }

  // Relative module specifiers in import/export/require/dynamic-import. The
  // `from` form is constrained to NOT cross a `;` or newline so an
  // `import x = require(...)` (no `from`) on one line isn't swallowed by a
  // later `... from "..."` on another line.
  const moduleSpecifier =
    /(?:import|export)[^;\n]*?from\s*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;
  let mm: RegExpExecArray | null = moduleSpecifier.exec(content);
  while (mm !== null) {
    const spec = mm[1] ?? mm[2] ?? mm[3] ?? mm[4];
    if (spec && (spec.startsWith("./") || spec.startsWith("../"))) {
      refs.push({ kind: "path", target: spec });
    }
    mm = moduleSpecifier.exec(content);
  }

  return refs;
}

/**
 * Resolve one extracted reference to an absolute declaration file inside the
 * tree, or undefined when it can't be resolved (skipped gracefully).
 */
async function resolveReference({
  ref,
  fromFile,
  nodeModulesDir,
}: {
  ref: FileReference;
  fromFile: string;
  nodeModulesDir: string;
}): Promise<string | undefined> {
  if (ref.kind === "types") {
    // `/// <reference types="node" />` -> @types/node (or own-typed pkg).
    const dir = path.join(
      nodeModulesDir,
      "@types",
      typesPackageDirName(ref.target),
    );
    const index = path.join(dir, "index.d.ts");
    if (await fileExists(index)) return index;
    return undefined;
  }

  // Path/relative reference, resolved against the referencing file's dir.
  const baseDir = path.dirname(fromFile);
  const raw = path.join(baseDir, ref.target);

  // Try as-is, then with .d.ts, then as a dir/index.d.ts.
  const candidates = [
    raw,
    `${raw}.d.ts`,
    `${raw}.d.mts`,
    `${raw}.d.cts`,
    path.join(raw, "index.d.ts"),
  ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return undefined;
}

// ─── Filesystem helpers ────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  try {
    const info = await stat(p);
    return info.isFile();
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const info = await stat(p);
    return info.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Recursively collect every `.d.ts` (and `.d.mts`/`.d.cts`) under `dir`,
 * skipping nested `node_modules`. Best-effort; unreadable dirs are skipped.
 */
async function walkDtsFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > 12) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of entries) {
      const full = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        if (dirent.name === "node_modules") continue;
        await walk(full, depth + 1);
      } else if (
        dirent.name.endsWith(".d.ts") ||
        dirent.name.endsWith(".d.mts") ||
        dirent.name.endsWith(".d.cts")
      ) {
        result.push(full);
      }
    }
  };
  await walk(dir, 0);
  return result;
}
