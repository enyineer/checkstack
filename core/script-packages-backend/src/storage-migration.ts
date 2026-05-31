import type { AdvisoryLockHandle } from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import type { BlobStore } from "./blob-store";
import { blobSha256 } from "./blob-hash";

/**
 * Storage-migration job: copy every blob from the active backend to a
 * target backend, verifying each copy byte-for-byte, then atomically flip
 * the active backend.
 *
 * Built on the Phase 2 blob-store registry's dual-backend read fallback:
 * while migrating, `script_package_storage_config.activeBackend` is still
 * the source, and reads fall back across both backends, so script execution
 * never breaks. Per-blob `backend` is flipped only AFTER a verified copy, so
 * a crash leaves a well-defined partial state that a resumed run re-derives
 * from the index (blobs already on the target are skipped).
 *
 * Verification note: blob bytes are our content-addressed archive (a gzip
 * tar of the Bun cache entry), NOT the npm tarball, so the SRI `integrity`
 * key does not hash the stored bytes. Verification therefore checks the
 * *copy* is faithful: hash the source bytes, hash the bytes read back from
 * the target, and require they match. A mismatch aborts the migration
 * cleanly (the active backend is left untouched).
 *
 * All collaborators are injected so the job is unit-testable without a DB
 * or real object storage.
 */

export interface StorageMigrationStores {
  /** Blobs whose recorded backend != target (the resumable work set). */
  listNotOnBackend(
    target: string,
  ): Promise<{ integrity: string; backend: string }[]>;
  /** Flip a blob's recorded backend after a verified copy. */
  setBackend(integrity: string, backend: string): Promise<void>;
}

export interface StorageMigrationConfig {
  beginMigration(target: string): Promise<void>;
  setMigratedCount(count: number): Promise<void>;
  completeMigration(target: string): Promise<void>;
  failMigration(message: string): Promise<void>;
}

export interface StorageMigrationDeps {
  blobIndex: StorageMigrationStores;
  storage: StorageMigrationConfig;
  /** Resolve a registered blob store by id (source + target). */
  getStore(id: string): BlobStore;
  /** Active backend id at job start (the migration source). */
  activeBackend: string;
  target: string;
  /** When true, delete each blob from the source after a verified copy. */
  gcSource?: boolean;
  logger?: { debug(msg: string): void; error(msg: string): void };
}

export interface StorageMigrationResult {
  migrated: number;
  /** True when every blob is verified on the target and the flip happened. */
  completed: boolean;
  error?: string;
}

/**
 * Run (or resume) a storage migration. Idempotent + resumable: the work set
 * is derived from the index each run, so blobs already flipped to the target
 * are skipped. Returns a result describing what happened; never throws for
 * an ordinary migration failure (it records `failMigration` and returns).
 */
export async function runStorageMigration(
  deps: StorageMigrationDeps,
): Promise<StorageMigrationResult> {
  const { blobIndex, storage, target, activeBackend } = deps;

  if (target === activeBackend) {
    return { migrated: 0, completed: true };
  }

  const targetStore = deps.getStore(target);
  await storage.beginMigration(target);

  let migrated = 0;
  try {
    const pending = await blobIndex.listNotOnBackend(target);
    for (const { integrity, backend } of pending) {
      // If the target already has it (idempotent re-run / prior partial),
      // just flip the index. Otherwise copy from the blob's current backend.
      let bytes: Uint8Array | undefined;
      if (await targetStore.has({ integrity })) {
        bytes = await targetStore.get({ integrity });
      } else {
        const sourceStore = deps.getStore(backend);
        const source = await sourceStore.get({ integrity });
        if (source === undefined) {
          throw new Error(
            `Blob ${integrity} missing from its source backend "${backend}"; cannot migrate.`,
          );
        }
        await targetStore.put({ integrity, bytes: source });
        // Read back from the target and verify the copy byte-for-byte.
        const readBack = await targetStore.get({ integrity });
        if (
          readBack === undefined ||
          blobSha256(readBack) !== blobSha256(source)
        ) {
          throw new Error(
            `Integrity verification failed for ${integrity}: target copy does not match source.`,
          );
        }
        bytes = source;

        if (deps.gcSource && backend !== target) {
          await sourceStore
            .delete({ integrity })
            .catch(() => {
              // GC is best-effort; a leftover source blob is harmless.
            });
        }
      }
      void bytes;
      await blobIndex.setBackend(integrity, target);
      migrated++;
      await storage.setMigratedCount(migrated);
    }

    await storage.completeMigration(target);
    deps.logger?.debug(
      `Storage migration to "${target}" complete (${migrated} blob(s)).`,
    );
    return { migrated, completed: true };
  } catch (error) {
    const message = extractErrorMessage(error);
    await storage.failMigration(message);
    deps.logger?.error(`Storage migration to "${target}" failed: ${message}`);
    return { migrated, completed: false, error: message };
  }
}

/** Current persisted migration state, as read on boot. */
export interface MigrationStateSnapshot {
  migrationStatus: string;
  migrationTarget: string | null;
  activeBackend: string;
}

export interface ResumeCrashedMigrationDeps {
  /** Read the current migration state (status + target + active backend). */
  loadState(): Promise<MigrationStateSnapshot>;
  /** Acquire the installer-election lock (so only one pod resumes). */
  tryLock(): Promise<AdvisoryLockHandle | null>;
  /**
   * Relaunch the migration toward `target`. Resolves when the (idempotent,
   * resumable) migration finishes. The caller controls whether this runs in
   * the background.
   */
  runMigration(input: {
    target: string;
    activeBackend: string;
  }): Promise<unknown>;
  logger?: { debug(msg: string): void; error(msg: string): void };
}

export interface ResumeCrashedMigrationResult {
  /** True when a resume was launched (status was "migrating", lock won). */
  resumed: boolean;
  reason?: string;
  /**
   * When `resumed`, a promise that settles once the relaunched migration
   * finishes and the lock is released. Production code fires-and-forgets;
   * tests can await it for deterministic assertions.
   */
  done?: Promise<void>;
}

/**
 * Boot-time backstop: if a prior migration crashed mid-flight it left
 * `migrationStatus === "migrating"`, which wedges the system (installs are
 * blocked and `triggerMigration` refuses to restart). Detect that and
 * relaunch the resumable migration under the installer-election lock, so
 * exactly one pod resumes. Returns immediately if there is nothing to resume
 * or another pod holds the lock; the actual migration may run in the
 * background (controlled by `runMigration`). The lock is released when
 * `runMigration` settles.
 */
export async function resumeCrashedMigration(
  deps: ResumeCrashedMigrationDeps,
): Promise<ResumeCrashedMigrationResult> {
  const state = await deps.loadState();
  if (state.migrationStatus !== "migrating" || !state.migrationTarget) {
    return { resumed: false, reason: "no migration in flight" };
  }
  const target = state.migrationTarget;

  const lock = await deps.tryLock();
  if (!lock) {
    return { resumed: false, reason: "another instance holds the lock" };
  }

  deps.logger?.debug(`Resuming crashed storage migration toward "${target}".`);
  const done = (async () => {
    try {
      await deps.runMigration({ target, activeBackend: state.activeBackend });
    } catch (error) {
      deps.logger?.error(
        `Storage-migration resume failed: ${extractErrorMessage(error)}`,
      );
    } finally {
      await lock.release();
    }
  })();
  return { resumed: true, done };
}
