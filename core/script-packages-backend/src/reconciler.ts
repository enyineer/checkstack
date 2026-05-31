import type { ManifestEntry } from "@checkstack/script-packages-common";
import { computeMissingBlobs } from "./reconcile-diff";

/**
 * Host reconciler: converge this host's local materialized `node_modules`
 * to the desired `lockfileHash`. Identical logic on every core instance and
 * each satellite - only the blob transport differs (shared blob store on
 * core; HTTP-via-core on satellites), injected as `fetchBlob`.
 *
 * Idempotent: a host already at `lockfileHash` is a no-op. Reconcile is
 * triggered on startup, on the `script-packages.changed` hook (core) /
 * `RefreshScriptPackages` push (satellite), and on assignment-sync
 * (backstop), so a host that missed the broadcast still converges.
 *
 * The heavy I/O (cache seeding, `bun install --offline`, symlink flip) is
 * injected so the orchestration is unit-testable; the concrete adapter
 * lives in `reconcile-fs.ts`.
 */

export interface ReconcileDeps {
  /** Integrities already present in this host's local cache. */
  localCacheIntegrities(): Promise<string[]>;
  /** Fetch one blob by integrity (shared store on core; HTTP on satellite). */
  fetchBlob(input: { integrity: string }): Promise<Uint8Array>;
  /** Seed a fetched blob into the local cache. */
  seedBlob(input: { entry: ManifestEntry; bytes: Uint8Array }): Promise<void>;
  /**
   * Materialize the tree for `lockfileHash` from the (now-complete) local
   * cache and atomically flip `current` at it. Returns when `current`
   * points at the new tree. No-op-safe if already materialized.
   */
  materializeAndFlip(input: {
    lockfileHash: string;
    manifest: ManifestEntry[];
  }): Promise<void>;
  /** The lockfileHash `current` already points at, if any. */
  currentLockfileHash(): Promise<string | undefined>;
  logger?: { debug(msg: string): void; error(msg: string): void };
}

export interface ReconcileResult {
  /** True when nothing needed doing (already at the desired hash). */
  alreadyConverged: boolean;
  pulledIntegrities: string[];
}

export async function reconcileToHash({
  lockfileHash,
  manifest,
  deps,
}: {
  lockfileHash: string;
  manifest: ManifestEntry[];
  deps: ReconcileDeps;
}): Promise<ReconcileResult> {
  const current = await deps.currentLockfileHash();
  if (current === lockfileHash) {
    deps.logger?.debug(
      `Script packages already at ${lockfileHash}; reconcile is a no-op.`,
    );
    return { alreadyConverged: true, pulledIntegrities: [] };
  }

  const localIntegrities = await deps.localCacheIntegrities();
  const missing = computeMissingBlobs({ manifest, localIntegrities });

  for (const entry of missing) {
    const bytes = await deps.fetchBlob({ integrity: entry.integrity });
    await deps.seedBlob({ entry, bytes });
  }

  await deps.materializeAndFlip({ lockfileHash, manifest });

  deps.logger?.debug(
    `Reconciled script packages to ${lockfileHash} (pulled ${missing.length} blob(s)).`,
  );
  return {
    alreadyConverged: false,
    pulledIntegrities: missing.map((e) => e.integrity),
  };
}
