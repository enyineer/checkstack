// Pure helpers for the editor's lazy Automatic Type Acquisition (ATA) loop.
//
// `parseBareImportSpecifiers` extracts the BARE package specifiers a script
// buffer imports/requires, so the editor can fetch + register only those
// packages' `.d.ts` on demand. `planAcquisitions` diffs that set against the
// already-acquired set so re-parsing on every keystroke never refetches.
//
// Both are pure + unit-tested (no monaco/DOM), per the no-DOM-tests rule.

/** Bare specifiers we never try to acquire (already typed or runtime built-ins). */
const IGNORED_SPECIFIERS = new Set<string>(["context"]);

/**
 * True for specifiers the editor must NOT try to acquire:
 *  - relative paths (`./x`, `../x`) — not packages.
 *  - `node:`-prefixed built-ins — already covered by the bundled @types/node.
 *  - `bun` / `bun:*` — covered by the bundled bun-types.
 *  - the injected `context` ambient global.
 */
function isIgnoredSpecifier(specifier: string): boolean {
  if (specifier.length === 0) return true;
  if (specifier.startsWith("./") || specifier.startsWith("../")) return true;
  if (specifier === "." || specifier === "..") return true;
  if (specifier.startsWith("node:")) return true;
  if (specifier === "bun" || specifier.startsWith("bun:")) return true;
  return IGNORED_SPECIFIERS.has(specifier);
}

/**
 * Reduce a possibly-subpath specifier to the package name to acquire:
 *  - `lodash/fp`        -> `lodash`
 *  - `@scope/pkg/sub`   -> `@scope/pkg`
 *  - `lodash`           -> `lodash`
 *  - `@scope/pkg`       -> `@scope/pkg`
 */
export function packageNameFromSpecifier(specifier: string): string {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

/**
 * Parse the unique BARE package names imported/required by a script buffer.
 * Handles every import/require form:
 *   import x from "p"; import {a} from "p"; import * as p from "p";
 *   import "p"; import type {T} from "p"; export {a} from "p";
 *   export * from "p"; const x = require("p"); await import("p")
 * Ignores relative paths, `node:`/`bun` built-ins, and the `context` global.
 * Subpath imports are reduced to their package name.
 */
export function parseBareImportSpecifiers(source: string): string[] {
  const found = new Set<string>();

  const patterns: RegExp[] = [
    // import ... from "p"  /  export ... from "p"  (incl. import type)
    /\b(?:import|export)\b[^;\n]*?\bfrom\s*["']([^"']+)["']/g,
    // bare side-effect import:  import "p"
    /\bimport\s*["']([^"']+)["']/g,
    // dynamic import:  import("p")
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    // require:  require("p")
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = pattern.exec(source);
    while (match !== null) {
      const specifier = match[1];
      if (!isIgnoredSpecifier(specifier)) {
        found.add(packageNameFromSpecifier(specifier));
      }
      match = pattern.exec(source);
    }
  }

  return [...found];
}

/**
 * Given the specifiers currently in the buffer and the set already acquired,
 * return only the NEW ones to fetch (order-stable). Pure planning step so the
 * ATA loop never refetches an already-registered package.
 */
export function planAcquisitions({
  specifiers,
  acquired,
}: {
  specifiers: string[];
  acquired: ReadonlySet<string>;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const specifier of specifiers) {
    if (acquired.has(specifier) || seen.has(specifier)) continue;
    seen.add(specifier);
    out.push(specifier);
  }
  return out;
}

/**
 * The cursor's position inside an import-string literal, as detected from the
 * text on the current line up to (but not including) the cursor.
 *
 * `partial` is the specifier text already typed between the opening quote and
 * the cursor; `replaceFromColumn` is the 1-based editor column of the FIRST
 * specifier character (i.e. just after the opening quote), so a completion can
 * replace the whole partial specifier without touching the quotes.
 */
export interface ImportSpecifierCompletionContext {
  partial: string;
  /** 1-based column where the specifier text starts (just after the quote). */
  replaceFromColumn: number;
}

// The import/require lead-ins that put a following string literal in
// module-specifier position. Each is matched at the END of the line-up-to-
// cursor, immediately followed by an OPEN (unclosed) quote + the partial text.
//
//   ... from "      ->  from-clause (import/export)
//   import "        ->  bare side-effect import
//   import(" / require("  ->  dynamic import / require call
//
// We deliberately match only an UNCLOSED string (no closing quote between the
// opening quote and the cursor) so completions never fire once the specifier
// string is already closed.
const IMPORT_STRING_LEAD_INS: RegExp[] = [
  // `from "partial`  (import ... from / export ... from)
  /\bfrom\s*(["'])([^"']*)$/,
  // `import "partial`  (bare side-effect import) — `import` not followed by `(`
  /\bimport\s*(["'])([^"']*)$/,
  // `import("partial`  (dynamic import)
  /\bimport\s*\(\s*(["'])([^"']*)$/,
  // `require("partial`  (CJS require)
  /\brequire\s*\(\s*(["'])([^"']*)$/,
];

/**
 * Detect whether the cursor sits inside an import/require module-specifier
 * STRING, and if so return the partial specifier + where it starts. Returns
 * null otherwise (so a completion provider can bail and not pollute normal
 * positions).
 *
 * `lineUpToCursor` is the current line's text from column 1 up to the cursor
 * (exclusive). Pure + unit-tested; no editor/DOM dependency.
 */
export function importSpecifierCompletionContext(
  lineUpToCursor: string,
): ImportSpecifierCompletionContext | null {
  for (const pattern of IMPORT_STRING_LEAD_INS) {
    const match = pattern.exec(lineUpToCursor);
    if (!match) continue;
    const partial = match[2];
    // The partial starts right after the opening quote. The quote's index is
    // (matchEnd - partial.length - 1); the partial's first char is one past
    // that. Editor columns are 1-based, so add 1 to the 0-based index.
    const partialStartIndex = lineUpToCursor.length - partial.length;
    return { partial, replaceFromColumn: partialStartIndex + 1 };
  }
  return null;
}

/**
 * Filter a raw manifest package-name list down to the names a user can
 * actually `import`: drop `@types/*` companions (you import `lodash`, never
 * `@types/lodash`), dedupe, and sort. Pure + unit-tested.
 */
export function importablePackageNames(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const name of names) {
    if (name.startsWith("@types/")) continue;
    out.add(name);
  }
  return [...out].toSorted((a, b) => a.localeCompare(b));
}

/**
 * Extract the importable built-in module specifiers from bundled stdlib
 * declaration text (`@types/node` + `bun-types`). Every importable built-in is
 * declared as a top-level `declare module "<spec>"` (e.g. `node:fs`, bare `fs`,
 * `bun`, `bun:test`), so the authoritative name set is exactly those names.
 *
 * Filter rules (documented):
 *  - Keep any `declare module "<spec>"` name that is a real specifier.
 *  - DROP names containing a star character — those are wildcard / asset-glob
 *    ambient shims (e.g. text/css asset globs or a "bun.lock" path glob), not
 *    importable runtime modules.
 *
 * Pure + unit-tested. Used at BUILD time by the stdlib-types generator to emit
 * the static name list the editor ships.
 */
export function extractBuiltinModuleSpecifiers(
  declarationText: string,
): string[] {
  const out = new Set<string>();
  // Top-level `declare module "<spec>"` (single or double quotes), anchored to
  // a statement start (per line, via the `m` flag) so we don't match
  // augmentation blocks nested deeper — though stdlib's importable modules are
  // all declared at top level anyway.
  const pattern = /^\s*declare\s+module\s+["']([^"']+)["']/gm;
  let match: RegExpExecArray | null = pattern.exec(declarationText);
  while (match !== null) {
    const spec = match[1];
    // Drop wildcard / asset-glob ambient shims (any name containing a star,
    // e.g. an asset-glob like a ".txt" shim or a "bun.lock" path glob): those
    // are ambient module shims, not importable runtime modules.
    if (!spec.includes("*")) {
      out.add(spec);
    }
    match = pattern.exec(declarationText);
  }
  return [...out].toSorted((a, b) => a.localeCompare(b));
}

/** A built-in import specifier plus how it should read in the completion list. */
export interface BuiltinModuleSpecifier {
  name: string;
  /** Completion `detail`, e.g. "Node.js" or "Bun built-in". */
  detail: string;
}

/**
 * Classify a built-in specifier for completion display: `bun` and any
 * `bun:`-prefixed specifier are Bun built-ins; everything else (the
 * `node:`-prefixed and bare node builtins) is Node.js. Pure.
 */
export function classifyBuiltinModule(name: string): BuiltinModuleSpecifier {
  const isBun = name === "bun" || name.startsWith("bun:");
  return { name, detail: isBun ? "Bun built-in" : "Node.js" };
}

/** One entry in the merged import-name completion list. */
export interface ImportCompletionEntry {
  name: string;
  /** Completion `detail`, e.g. "installed package" / "Node.js" / "Bun built-in". */
  detail: string;
}

/**
 * Merge the always-available runtime built-ins with the injected installed
 * package names into the final import-name completion list. Built-ins are
 * always present (importable in the sandbox regardless of the allowlist);
 * installed packages augment them. Deduped (installed names win their own
 * `detail`) and sorted. Pure + unit-tested.
 */
export function mergeImportCompletionEntries({
  builtins,
  installedPackages,
}: {
  builtins: readonly string[];
  installedPackages: readonly string[];
}): ImportCompletionEntry[] {
  const byName = new Map<string, ImportCompletionEntry>();
  for (const name of builtins) {
    const { detail } = classifyBuiltinModule(name);
    byName.set(name, { name, detail });
  }
  // Installed packages are already `@types/*`-free + deduped by the caller, but
  // be defensive. An installed package name that collides with a built-in is
  // re-labelled as an installed package (unlikely, but deterministic).
  for (const name of installedPackages) {
    byName.set(name, { name, detail: "installed package" });
  }
  return [...byName.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}
