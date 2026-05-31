import type {
  BlobGcSummary,
  ManifestEntry,
} from "@checkstack/script-packages-common";
import { DEFAULT_BLOB_GC_GRACE_MS } from "@checkstack/script-packages-common";
import { extractErrorMessage } from "@checkstack/common";

/**
 * Blob garbage collection: prune content-addressed blobs no longer referenced
 * by any RETAINED lockfile manifest (the current desired hash + the previous
 * N), older than a grace window.
 *
 * GC is destructive, so every deletion is provably safe:
 *  - **Retained set:** the union of blob integrities across the retained
 *    manifests (current + previous N). Any blob NOT in that union is a
 *    candidate. When in doubt we retain.
 *  - **Grace window:** a candidate is only deleted when it is older than the
 *    grace window (keyed on `script_package_blob.created_at`), so a pod /
 *    satellite mid-reconcile toward a just-superseded hash can still pull a
 *    blob that was just dropped from the retained set.
 *  - **Mutual exclusion:** the caller holds the installer-election advisory
 *    lock while GC runs AND we re-check `isBusy()` (install OR migration in
 *    flight) before deleting, so GC can never race a concurrent install that
 *    is publishing blobs for a new hash.
 *  - **Per-backend routing:** each blob is deleted from the backend recorded
 *    in its index row, then the index row is removed.
 *
 * All collaborators are injected so the orchestration is unit-testable
 * without a DB or a real blob store.
 */

/** One indexed blob, as the GC needs to see it. */
export interface GcBlob {
  integrity: string;
  backend: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface BlobGcDeps {
  /**
   * The retained manifests: the current desired manifest plus the previous N
   * (most-recent-first or any order; only the union of integrities matters).
   */
  retainedManifests(): Promise<ManifestEntry[][]>;
  /** Every indexed blob (integrity + backend + size + created_at). */
  listBlobs(): Promise<GcBlob[]>;
  /** Delete a blob's bytes from `backend`, then its index row. Idempotent. */
  deleteBlob(input: { integrity: string; backend: string }): Promise<void>;
  /**
   * True while an install OR a storage migration is in flight. Re-checked
   * AFTER the lock is held (an install on this very pod could be mid-publish
   * without holding the installer lock for the whole window).
   */
  isBusy(): Promise<boolean>;
  /** Record the run summary (for the admin UI). Best-effort. */
  recordRun?(input: {
    deleted: number;
    bytesReclaimed: number;
  }): Promise<void>;
  /** Now, injectable for deterministic grace tests. */
  now?(): number;
  /** Grace window in ms (default 24h). */
  graceMs?: number;
  logger?: { debug(msg: string): void; error(msg: string): void };
}

/**
 * Run one blob-GC pass. The caller MUST already hold the installer-election
 * advisory lock (so an install/migration cannot start mid-pass); this
 * function additionally refuses if `isBusy()` reports an active install /
 * migration, as a belt-and-braces guard.
 *
 * Idempotent: a second run with the same inputs finds the just-deleted blobs
 * gone and reports zero further deletions.
 */
export async function runBlobGc({
  deps,
}: {
  deps: BlobGcDeps;
}): Promise<BlobGcSummary> {
  const graceMs = deps.graceMs ?? DEFAULT_BLOB_GC_GRACE_MS;
  const now = deps.now?.() ?? Date.now();

  if (await deps.isBusy()) {
    const reason =
      "An install or storage migration is in flight; skipping blob GC.";
    deps.logger?.debug(reason);
    return {
      ran: false,
      reason,
      candidates: 0,
      deleted: 0,
      keptWithinGrace: 0,
      bytesReclaimed: 0,
    };
  }

  // Retained set = union of integrities across every retained manifest.
  const retained = new Set<string>();
  for (const manifest of await deps.retainedManifests()) {
    for (const entry of manifest) retained.add(entry.integrity);
  }

  const blobs = await deps.listBlobs();
  const candidates = blobs.filter((b) => !retained.has(b.integrity));

  let deleted = 0;
  let keptWithinGrace = 0;
  let bytesReclaimed = 0;

  for (const blob of candidates) {
    const ageMs = now - blob.createdAt.getTime();
    if (ageMs < graceMs) {
      keptWithinGrace++;
      deps.logger?.debug(
        `Blob GC: keeping unreferenced ${blob.integrity} (age ${Math.round(
          ageMs / 1000,
        )}s < grace ${Math.round(graceMs / 1000)}s).`,
      );
      continue;
    }
    try {
      await deps.deleteBlob({
        integrity: blob.integrity,
        backend: blob.backend,
      });
      deleted++;
      bytesReclaimed += blob.sizeBytes;
      deps.logger?.debug(
        `Blob GC: deleted ${blob.integrity} from "${blob.backend}" ` +
          `(${blob.sizeBytes} bytes).`,
      );
    } catch (error) {
      // A single failed delete must not abort the whole pass; the blob is
      // simply retained until the next run. Never silently swallow: log it.
      deps.logger?.error(
        `Blob GC: failed to delete ${blob.integrity} from "${blob.backend}": ${extractErrorMessage(
          error,
        )}. Retaining for the next pass.`,
      );
    }
  }

  await deps.recordRun?.({ deleted, bytesReclaimed }).catch(() => {
    // Recording the summary is best-effort UI state; never fail the pass.
  });

  deps.logger?.debug(
    `Blob GC complete: ${candidates.length} candidate(s), ${deleted} deleted ` +
      `(${bytesReclaimed} bytes), ${keptWithinGrace} kept within grace.`,
  );

  return {
    ran: true,
    candidates: candidates.length,
    deleted,
    keptWithinGrace,
    bytesReclaimed,
  };
}
