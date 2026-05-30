import path from "node:path";

/**
 * Resolve the on-disk root for the managed package store on this host.
 *
 * No general backend data-dir convention exists in the repo yet, so we
 * introduce `CHECKSTACK_DATA_DIR` (env), defaulting to a `.data/` dir under
 * the backend's CWD. Script packages live at `<dataDir>/script-packages/`.
 *
 * The store contains a generated `package.json`, `bun.lock`, the
 * content-addressed cache, versioned `trees/<lockfileHash>/`, the `current`
 * symlink, and `.runs/<uuid>/` scratch dirs for runner resolution.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CHECKSTACK_DATA_DIR;
  if (configured && configured.trim().length > 0) {
    return path.resolve(configured);
  }
  return path.resolve(process.cwd(), ".data");
}

/** `<dataDir>/script-packages` - the managed package store root. */
export function resolveScriptPackagesDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveDataDir(env), "script-packages");
}

/** Subpaths inside the package store. */
export function storePaths(storeRoot: string) {
  return {
    root: storeRoot,
    /** Content-addressed blob cache (compressed blobs keyed by integrity). */
    cache: path.join(storeRoot, "cache"),
    /** Versioned materialized trees: `trees/<lockfileHash>/node_modules`. */
    trees: path.join(storeRoot, "trees"),
    /** Atomically-flipped symlink to the active tree. */
    current: path.join(storeRoot, "current"),
    /** Per-run scratch dirs for runner resolution. */
    runs: path.join(storeRoot, ".runs"),
  };
}
