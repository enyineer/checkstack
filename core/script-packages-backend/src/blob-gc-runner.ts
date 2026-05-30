import type {
  BlobGcSummary,
  ManifestEntry,
} from "@checkstack/script-packages-common";
import {
  DEFAULT_BLOB_GC_GRACE_MS,
  DEFAULT_BLOB_GC_RETAIN_PREVIOUS,
} from "@checkstack/script-packages-common";
import { extractErrorMessage } from "@checkstack/common";
import type { InstallerLock } from "./install-state-store";
import type { BlobStoreRegistry } from "./blob-store-registry";
import { runBlobGc, type GcBlob } from "./blob-gc";

/**
 * Build a `triggerBlobGc()` callable that wires the pure {@link runBlobGc}
 * orchestration to the real stores + blob backends, and is shared by the
 * admin `gcBlobs` RPC and the scheduled recurring job (so the safety logic
 * lives in exactly one place).
 *
 * Mutual exclusion: the trigger takes the installer-election advisory lock
 * for the whole pass, so a concurrent install / migration (which contend for
 * the same lock) cannot run while GC does, and vice versa. If the lock is
 * held, GC refuses cleanly (the install / migration wins; GC retries on its
 * next scheduled run). On top of the lock, {@link runBlobGc} re-checks
 * `isBusy()`.
 *
 * Retained set: the current desired manifest PLUS the previous N hashes'
 * manifests, from lockfile history. History older than the retention window
 * is pruned after a successful pass.
 */
export interface BlobGcRunnerDeps {
  installerLock: InstallerLock;
  blobStores: BlobStoreRegistry;
  /** Current desired manifest + hash (from install state). */
  loadCurrent(): Promise<{
    lockfileHash: string | null;
    manifest: ManifestEntry[];
  }>;
  /** Most-recent `limit` manifests from lockfile history (newest first). */
  recentHistory(limit: number): Promise<ManifestEntry[][]>;
  /** Prune history rows beyond the most-recent `keep` hashes. */
  pruneHistory(keep: number): Promise<void>;
  /** Every indexed blob with size + created_at. */
  listBlobs(): Promise<GcBlob[]>;
  /** Remove a blob's index row (after its bytes are deleted). */
  removeBlobRow(integrity: string): Promise<void>;
  /** True while an install OR storage migration is in flight. */
  isBusy(): Promise<boolean>;
  /** Persist the run summary for the admin UI. */
  recordRun(input: { deleted: number; bytesReclaimed: number }): Promise<void>;
  /** Keep current + this many previous hashes (default 1). */
  retainPrevious?: number;
  /** Grace window in ms (default 24h). */
  graceMs?: number;
  logger?: { debug(msg: string): void; error(msg: string): void };
}

export function createBlobGcTrigger(
  deps: BlobGcRunnerDeps,
): () => Promise<BlobGcSummary> {
  const retainPrevious = deps.retainPrevious ?? DEFAULT_BLOB_GC_RETAIN_PREVIOUS;
  const graceMs = deps.graceMs ?? DEFAULT_BLOB_GC_GRACE_MS;

  return async function triggerBlobGc(): Promise<BlobGcSummary> {
    // Election: hold the installer lock for the whole pass so an install /
    // migration cannot start concurrently (they contend for the same lock).
    const lock = await deps.installerLock.tryInstallerLock();
    if (!lock) {
      const reason =
        "An install or storage migration holds the installer lock; skipping blob GC.";
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

    try {
      // Retain current + previous N. We pull `retainPrevious + 1` history
      // rows (the current hash is itself recorded in history on install) and
      // additionally union the live install-state manifest in case history
      // hasn't caught up yet — when in doubt, retain.
      return await runBlobGc({
        deps: {
          retainedManifests: async () => {
            const manifests = await deps.recentHistory(retainPrevious + 1);
            const current = await deps.loadCurrent();
            if (current.lockfileHash && current.manifest.length > 0) {
              manifests.push(current.manifest);
            }
            return manifests;
          },
          listBlobs: deps.listBlobs,
          deleteBlob: async ({ integrity, backend }) => {
            // Route the byte-delete to the blob's recorded backend, then drop
            // the index row. If the backend isn't registered (shouldn't
            // happen), skip the byte-delete but still drop the row so a
            // dangling reference doesn't linger.
            if (deps.blobStores.has(backend)) {
              await deps.blobStores.get(backend).delete({ integrity });
            } else {
              deps.logger?.error(
                `Blob GC: backend "${backend}" for ${integrity} not registered; dropping index row only.`,
              );
            }
            await deps.removeBlobRow(integrity);
          },
          isBusy: deps.isBusy,
          recordRun: deps.recordRun,
          graceMs,
          logger: deps.logger,
        },
      });
    } catch (error) {
      const message = extractErrorMessage(error);
      deps.logger?.error(`Blob GC pass failed: ${message}`);
      return {
        ran: false,
        reason: message,
        candidates: 0,
        deleted: 0,
        keptWithinGrace: 0,
        bytesReclaimed: 0,
      };
    } finally {
      // Prune history beyond the retained window (best-effort), then release.
      await deps.pruneHistory(retainPrevious + 1).catch((error) => {
        deps.logger?.error(
          `Blob GC: pruning lockfile history failed: ${extractErrorMessage(error)}`,
        );
      });
      await lock.release();
    }
  };
}
