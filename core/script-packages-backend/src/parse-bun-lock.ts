import type { ManifestEntry } from "@checkstack/script-packages-common";

/**
 * Parse a Bun text lockfile (`bun.lock`) into manifest entries.
 *
 * The lockfile is JSONC-ish (trailing commas) with a `packages` map whose
 * values are tuples `[ "<name>@<version>", <registry>, <meta>, <integrity> ]`.
 * We extract `name`, `version`, and `integrity` (the content-addressed
 * key). Entries without an integrity (e.g. workspace/link packages) are
 * skipped - they aren't distributable blobs.
 */

interface BunLock {
  packages?: Record<string, unknown>;
}

/** Strip trailing commas so JSON.parse accepts Bun's lockfile. */
function stripTrailingCommas(text: string): string {
  return text.replaceAll(/,(\s*[}\]])/g, "$1");
}

/** Split a `name@version` spec, honoring scoped names (`@scope/name@v`). */
export function splitSpec(
  spec: string,
): { name: string; version: string } | undefined {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return undefined;
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  if (name.length === 0 || version.length === 0) return undefined;
  return { name, version };
}

export function parseBunLock(text: string): ManifestEntry[] {
  let parsed: BunLock;
  try {
    parsed = JSON.parse(stripTrailingCommas(text)) as BunLock;
  } catch {
    throw new Error("Failed to parse bun.lock: invalid lockfile format");
  }

  const entries: ManifestEntry[] = [];
  const seen = new Set<string>();

  for (const value of Object.values(parsed.packages ?? {})) {
    if (!Array.isArray(value)) continue;
    const spec = value[0];
    const integrity = value.at(-1);
    if (typeof spec !== "string" || typeof integrity !== "string") continue;
    if (!integrity.includes("-")) continue; // not an sri hash
    const split = splitSpec(spec);
    if (!split) continue;
    if (seen.has(integrity)) continue;
    seen.add(integrity);
    entries.push({ ...split, integrity });
  }

  return entries;
}
