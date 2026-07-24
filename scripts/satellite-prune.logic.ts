/**
 * Pure logic for the satellite image prune (see `prune-for-satellite.ts`).
 *
 * The satellite container ships only the workspace packages it actually needs.
 * Those come from TWO places, and missing either one crash-loops the agent with
 * an `ENOENT` at startup:
 *
 * 1. STATIC deps - everything in the satellite package's transitive runtime
 *    `dependencies` closure (backend-api, healthcheck-execution, the telemetry
 *    contracts it imports, ...). Discoverable from `package.json`.
 * 2. DYNAMIC plugins - the `healthcheck-*-backend` / `collector-*-backend`
 *    plugins the satellite discovers at runtime by scanning `plugins/`
 *    (`core/satellite/src/strategy-loader.ts`). These are NOT satellite
 *    dependencies, so a walk rooted only at the satellite would delete them and
 *    break all checks - AND each of them drags in its own transitive deps.
 *
 * So the keep-set is the dependency closure of the satellite PLUS every
 * dynamically-loaded backend as an additional root. This module computes that
 * set from a plain list of packages so it can be unit-tested without a
 * filesystem.
 */
// The satellite OWNS the "which plugins do I load" predicate (its runtime
// strategy loader uses the same function). It is an app package, so it is not
// resolvable by package name from a build script - imported by relative path
// so the prune and the runtime share ONE definition and cannot drift.
import { isSatelliteLoadedPluginDir } from "../core/satellite/src/plugin-discovery";

/** A workspace package, reduced to what the prune needs. */
export interface PrunePackage {
  /** Package name, e.g. `@checkstack/backend-api`. */
  name: string;
  /** Repo-relative dir, e.g. `core/backend-api` or `plugins/healthcheck-http-backend`. */
  relDir: string;
  /** `@checkstack/*` RUNTIME dependency names (from `dependencies` only). */
  deps: string[];
}

/**
 * Whether a repo-relative dir is a plugin the satellite loads DYNAMICALLY at
 * runtime. The "top-level `plugins/` dir" framing is the prune's (it walks
 * repo-relative dirs); the NAME pattern is delegated to the satellite's own
 * `isSatelliteLoadedPluginDir`, the SAME predicate its runtime scanner uses, so
 * the prune and the runtime can never disagree about what to keep.
 */
export function isDynamicSatellitePlugin(relDir: string): boolean {
  const parts = relDir.split("/");
  if (parts.length !== 2 || parts[0] !== "plugins") return false;
  return isSatelliteLoadedPluginDir(parts[1]);
}

/**
 * The root package names whose closures must be kept: the satellite itself plus
 * every dynamically-loaded backend.
 */
export function satelliteKeepRoots({
  packages,
  satelliteName,
}: {
  packages: PrunePackage[];
  satelliteName: string;
}): string[] {
  const dynamic = packages
    .filter((p) => isDynamicSatellitePlugin(p.relDir))
    .map((p) => p.name);
  return [satelliteName, ...dynamic];
}

/**
 * The transitive runtime-dependency closure of `rootNames` over `packages`.
 * Names not present in `packages` (external npm deps) are simply not walked -
 * only workspace packages are ever candidates for pruning. The roots are always
 * kept.
 */
export function computeKeepSet({
  packages,
  rootNames,
}: {
  packages: PrunePackage[];
  rootNames: string[];
}): Set<string> {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const keep = new Set<string>();
  const stack = [...rootNames];
  while (stack.length > 0) {
    const name = stack.pop();
    if (name === undefined || keep.has(name)) continue;
    const pkg = byName.get(name);
    // An unknown name is an external dep (or the satellite root itself when it
    // was passed but not in `packages`); mark it kept if it is a workspace
    // package, otherwise ignore. We only add to `keep` for names we can walk.
    if (!pkg) continue;
    keep.add(name);
    for (const dep of pkg.deps) stack.push(dep);
  }
  return keep;
}

/**
 * Compute which workspace package DIRS the satellite image should delete: every
 * `core/*` or `plugins/*` package NOT in the keep-set. Packages outside those
 * two trees (e.g. `docs`) are never touched.
 *
 * Returns both the keep-set (for logging / assertions) and the removable dirs.
 * A caller MUST sanity-check `keep` is non-trivial before deleting - a bug that
 * produced an empty keep-set would otherwise wipe the image.
 */
export function computeSatellitePrune({
  packages,
  satelliteName,
}: {
  packages: PrunePackage[];
  satelliteName: string;
}): { keep: Set<string>; removeDirs: string[] } {
  const roots = satelliteKeepRoots({ packages, satelliteName });
  const keep = computeKeepSet({ packages, rootNames: roots });
  const removeDirs = packages
    .filter(
      (p) =>
        (p.relDir.startsWith("core/") || p.relDir.startsWith("plugins/")) &&
        !keep.has(p.name),
    )
    .map((p) => p.relDir)
    .toSorted();
  return { keep, removeDirs };
}
