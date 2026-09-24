import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Map manifest entries to their on-disk Bun cache entry directory names.
 *
 * Bun extracts each package into `<cacheDir>/<name>@<version>@@@<n>` (the
 * `@@@<n>` suffix is an internal dedupe counter). We discover the actual
 * entry dir by listing the cache and matching the `<name>@<version>`
 * prefix, rather than hardcoding the suffix - keeping us tolerant of Bun's
 * internal counter. Scoped packages (`@scope/name`) live under a `@scope/`
 * subdir in the cache.
 *
 * Since Bun 1.4, the cache also holds registry packument metadata as
 * `<hash>.npm` files at the cache root (binary `bun-npm-manifest-cache`
 * format, filename = deterministic hash of registry + package). Offline
 * installs resolve versions FROM those files - a cache with only extracted
 * entry dirs fails `bun install --offline` with "no cached manifest". Their
 * name cannot be recomputed (Bun-internal hash), so we DISCOVER the sidecar
 * for a package by content: the packument stores the package name verbatim.
 * A containment match can false-positive on similar names (`leftpad` vs
 * `leftpad-cli`); that only bloats a blob with an unused packument, never
 * breaks resolution.
 */

export interface CacheEntryLocation {
  /** Directory the entry sits *under* (its parent), for tar's cwd. */
  parentDir: string;
  /** The entry dir name relative to `parentDir`. */
  entryName: string;
}

function specPrefix(name: string, version: string): string {
  return `${name}@${version}@@@`;
}

/**
 * Find the cache entry dir for `name@version`. Returns undefined if the
 * cache doesn't contain it (caller treats as a resolve error).
 */
export async function findCacheEntry({
  cacheDir,
  name,
  version,
}: {
  cacheDir: string;
  name: string;
  version: string;
}): Promise<CacheEntryLocation | undefined> {
  if (name.startsWith("@")) {
    // Scoped: `<cacheDir>/@scope/name@version@@@n`
    const [scope, bare] = name.split("/");
    const scopeDir = `${cacheDir}/${scope}`;
    const prefix = `${bare}@${version}@@@`;
    const match = await firstMatch(scopeDir, prefix);
    if (!match) return;
    return { parentDir: scopeDir, entryName: match };
  }
  const prefix = specPrefix(name, version);
  const match = await firstMatch(cacheDir, prefix);
  if (!match) return;
  return { parentDir: cacheDir, entryName: match };
}

async function firstMatch(
  dir: string,
  prefix: string,
): Promise<string | undefined> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  return names.find((n) => n.startsWith(prefix));
}

/**
 * Find Bun's registry manifest-cache sidecar file(s) (`<hash>.npm` at the
 * cache root) whose packument mentions `name`. Needed so a published blob
 * can reconstruct an offline install on Bun >= 1.4 (see module doc). Returns
 * the sidecar FILENAMES relative to `cacheDir`; empty when the cache has no
 * matching sidecars (older Bun, or a package with none) - callers pack the
 * entry dir alone in that case, which stays correct on those Bun versions.
 */
export async function findManifestSidecars({
  cacheDir,
  name,
}: {
  cacheDir: string;
  name: string;
}): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(cacheDir);
  } catch {
    return [];
  }
  const sidecars = names.filter((n) => n.endsWith(".npm"));
  const matches: string[] = [];
  for (const sidecar of sidecars) {
    try {
      const bytes = await readFile(path.join(cacheDir, sidecar));
      // Latin-1 decode keeps every byte as-is, so ASCII substrings (package
      // names) survive in the binary packument format.
      if (new TextDecoder("latin1").decode(bytes).includes(name)) {
        matches.push(sidecar);
      }
    } catch {
      // A vanished/unreadable sidecar is not worth failing a resolve over.
    }
  }
  return matches;
}
