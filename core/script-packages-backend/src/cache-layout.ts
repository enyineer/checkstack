import { readdir } from "node:fs/promises";

/**
 * Map manifest entries to their on-disk Bun cache entry directory names.
 *
 * Bun extracts each package into `<cacheDir>/<name>@<version>@@@<n>` (the
 * `@@@<n>` suffix is an internal dedupe counter). We discover the actual
 * entry dir by listing the cache and matching the `<name>@<version>`
 * prefix, rather than hardcoding the suffix - keeping us tolerant of Bun's
 * internal counter. Scoped packages (`@scope/name`) live under a `@scope/`
 * subdir in the cache.
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
