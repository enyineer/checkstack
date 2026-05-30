import { stat } from "node:fs/promises";
import path from "node:path";
import type { SafeDatabase } from "@checkstack/backend-api";
import { storePaths, resolveScriptPackagesDir } from "./data-dir";
import { readCurrentTarget } from "./atomic-symlink";
import { createInstallStateStore } from "./install-state-store";
import { scriptPackageInstallState } from "./schema";

/**
 * What a script-execution call site should do about package resolution.
 *
 *  - `none`     — no packages are configured (desired hash is null). The
 *                 caller leaves `resolutionRoot` UNSET so the runner uses
 *                 `os.tmpdir()` exactly as before: non-package scripts are
 *                 completely unaffected.
 *  - `ready`    — packages are configured AND this host has materialized
 *                 the desired tree. The caller passes `root` as the runner's
 *                 `resolutionRoot` so `import "<pkg>"` resolves.
 *  - `notReady` — packages ARE configured but this host hasn't materialized
 *                 the desired hash yet (cold start, mid-reconcile, or a
 *                 failed reconcile). The caller MUST surface a clear error
 *                 on any package import rather than running against a stale
 *                 or empty tree. `reason` is a ready-to-surface message.
 */
export type ResolutionRootStatus =
  | { mode: "none" }
  | { mode: "ready"; root: string }
  | { mode: "notReady"; reason: string };

async function symlinkResolvesToTree(currentPath: string): Promise<boolean> {
  // `current` is a symlink to `trees/<hash>`; require it to resolve to a
  // real dir with a node_modules so we never point the runner at a
  // half-built / missing tree.
  const target = await readCurrentTarget(currentPath);
  if (!target) return false;
  const resolved = path.isAbsolute(target)
    ? target
    : path.join(path.dirname(currentPath), target);
  try {
    const info = await stat(path.join(resolved, "node_modules"));
    return info.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Decide the resolution-root status for a script execution on this host.
 *
 * @param desiredLockfileHash the install state's desired hash (null = no
 *   packages configured).
 * @param storeRoot the package-store root (`<dataDir>/script-packages`),
 *   identical shape on core and satellites.
 * @param hostLabel "central backend" | "satellite" — woven into the
 *   not-ready error so operators know which host to look at.
 */
export async function resolveResolutionRoot({
  desiredLockfileHash,
  storeRoot,
  hostLabel = "central backend",
}: {
  desiredLockfileHash: string | null;
  storeRoot: string;
  hostLabel?: string;
}): Promise<ResolutionRootStatus> {
  if (desiredLockfileHash === null) {
    return { mode: "none" };
  }
  const paths = storePaths(storeRoot);
  const currentHash = await readCurrentTarget(paths.current).then((target) =>
    target ? path.basename(target) : undefined,
  );
  if (
    currentHash === desiredLockfileHash &&
    (await symlinkResolvesToTree(paths.current))
  ) {
    return { mode: "ready", root: paths.current };
  }
  return {
    mode: "notReady",
    reason: `npm packages not ready on this ${hostLabel} (expected ${desiredLockfileHash}${
      currentHash ? `, have ${currentHash}` : ", none materialized"
    }). The package set is still syncing; retry shortly.`,
  };
}

/**
 * Filesystem-only resolution: returns `ready` when `<store>/current`
 * resolves to a materialized tree, else `none`. Host-agnostic and needs no
 * DB / RPC / desired-hash, so it works on satellites (which have no script-
 * packages RPC) as well as core. Execution safety does NOT depend on the
 * `notReady` distinction: the runner always disables Bun auto-install, so a
 * missing package errors regardless. This resolver simply points the runner
 * at the synced tree when one exists.
 */
export async function resolveResolutionRootFromStore(
  storeRoot: string,
): Promise<ResolutionRootStatus> {
  const paths = storePaths(storeRoot);
  if (await symlinkResolvesToTree(paths.current)) {
    return { mode: "ready", root: paths.current };
  }
  return { mode: "none" };
}

/**
 * Convenience for central-backend call sites: read the desired hash from the
 * install state and resolve the local resolution-root status against the
 * default `<dataDir>/script-packages` store. Plugins that execute user
 * scripts call this per run.
 */
export async function resolveResolutionRootForHost({
  db,
  hostLabel = "central backend",
}: {
  db: SafeDatabase<{
    scriptPackageInstallState: typeof scriptPackageInstallState;
  }>;
  hostLabel?: string;
}): Promise<ResolutionRootStatus> {
  const state = await createInstallStateStore(db).load();
  return resolveResolutionRoot({
    desiredLockfileHash: state.lockfileHash,
    storeRoot: resolveScriptPackagesDir(),
    hostLabel,
  });
}
