import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type {
  ManifestEntry,
  PackageTypes,
} from "@checkstack/script-packages-common";

/**
 * Roll up the `.d.ts` for each manifest package from a materialized tree's
 * `node_modules`, for editor IntelliSense (Monaco `addExtraLib`).
 *
 * For each package we collect its own bundled `.d.ts` files plus any
 * `@types/<pkg>` companion, concatenate them, and wrap them in
 * `declare module '<name>' { ... }`. Packages without bundled types still
 * run; they just produce an empty `dts` (no autocomplete) - acceptable v1.
 *
 * Best-effort: a missing package dir or unreadable file is skipped, never
 * fatal. Bounded by `maxBytesPerPackage` so a pathological types bundle
 * can't bloat the editor payload.
 */

const DEFAULT_MAX_BYTES_PER_PACKAGE = 256 * 1024;

export async function rollupPackageTypes({
  nodeModulesDir,
  manifest,
  maxBytesPerPackage = DEFAULT_MAX_BYTES_PER_PACKAGE,
}: {
  nodeModulesDir: string;
  manifest: ManifestEntry[];
  maxBytesPerPackage?: number;
}): Promise<PackageTypes[]> {
  // De-dupe to top-level packages (manifest includes transitive deps; types
  // are only useful for packages a script can import by name - all of them
  // are importable from a flat node_modules, so include each unique name).
  const byName = new Map<string, ManifestEntry>();
  for (const entry of manifest) {
    if (!byName.has(entry.name)) byName.set(entry.name, entry);
  }

  const out: PackageTypes[] = [];
  for (const entry of byName.values()) {
    const dts = await rollupOne({
      nodeModulesDir,
      name: entry.name,
      maxBytes: maxBytesPerPackage,
    });
    out.push({ name: entry.name, version: entry.version, dts });
  }
  return out;
}

async function rollupOne({
  nodeModulesDir,
  name,
  maxBytes,
}: {
  nodeModulesDir: string;
  name: string;
  maxBytes: number;
}): Promise<string> {
  const pkgDir = path.join(nodeModulesDir, name);
  const typesDir = path.join(nodeModulesDir, "@types", ...name.split("/"));

  const collected: string[] = [];
  let total = 0;

  const addFrom = async (dir: string): Promise<void> => {
    if (total >= maxBytes) return;
    const files = await findDtsFiles(dir, maxBytes - total);
    for (const file of files) {
      if (total >= maxBytes) break;
      try {
        const content = await readFile(file, "utf8");
        collected.push(content);
        total += content.length;
      } catch {
        // Skip unreadable file.
      }
    }
  };

  await addFrom(pkgDir);
  await addFrom(typesDir);

  if (collected.length === 0) return "";

  const body = collected.join("\n");
  return `declare module ${JSON.stringify(name)} {\n${body}\n}\n`;
}

/**
 * Find `.d.ts` files under `dir`, shallowly recursing. Stops early once the
 * accumulated size would exceed `budget` to bound work on huge type
 * bundles.
 */
async function findDtsFiles(dir: string, budget: number): Promise<string[]> {
  const result: string[] = [];
  let used = 0;

  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > 6 || used >= budget) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of entries) {
      if (used >= budget) return;
      const full = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        if (dirent.name === "node_modules") continue;
        await walk(full, depth + 1);
      } else if (dirent.name.endsWith(".d.ts")) {
        try {
          const info = await stat(full);
          result.push(full);
          used += info.size;
        } catch {
          // Skip.
        }
      }
    }
  };

  await walk(dir, 0);
  return result;
}
