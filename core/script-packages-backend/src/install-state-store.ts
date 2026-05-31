import { eq } from "drizzle-orm";
import type {
  AdvisoryLockHandle,
  AdvisoryLockService,
  SafeDatabase,
} from "@checkstack/backend-api";
import type {
  InstallState,
  ManifestEntry,
} from "@checkstack/script-packages-common";
import { scriptPackageInstallState } from "./schema";

/**
 * Singleton install-state persistence (data) and the installer-election
 * advisory lock (coordination), kept as two separate factories so read-only
 * call sites (per-run resolution-root, router reads) depend only on the data
 * store and never need the pool-backed lock service.
 *
 * Exactly one core instance performs the registry-facing `bun install` at a
 * time, guarded by a Postgres advisory lock. The lock is held across a
 * MINUTES-long `bun install`, so it MUST use a dedicated pooled connection
 * (not a long-open transaction): {@link createInstallerLock} uses the shared
 * {@link AdvisoryLockService}, which checks out one client, acquires the
 * session lock on it, and releases on the SAME client. The lock auto-releases
 * when that connection dies, so a crashed installer never wedges the
 * election.
 */

const INSTALLER_LOCK_KEY = "script-packages.installer";
const SINGLETON_ID = "singleton";

type Schema = { scriptPackageInstallState: typeof scriptPackageInstallState };

export interface InstallStateStore {
  load(): Promise<InstallState>;
  setInstalling(): Promise<void>;
  setReady(input: {
    lockfileHash: string;
    manifest: ManifestEntry[];
    totalSizeBytes: number;
  }): Promise<void>;
  setError(message: string): Promise<void>;
}

export interface InstallerLock {
  /**
   * Acquire the installer-election lock on a dedicated client. Returns a
   * handle (call `release()` in a `finally`) on success, or `null` if
   * another instance already holds it.
   */
  tryInstallerLock(): Promise<AdvisoryLockHandle | null>;
}

/**
 * The installer-election lock, backed by the pool-backed advisory-lock
 * service so the session lock keeps connection affinity across the long
 * `bun install`.
 */
export function createInstallerLock(
  advisoryLock: AdvisoryLockService,
): InstallerLock {
  return {
    async tryInstallerLock() {
      return advisoryLock.tryAcquire(INSTALLER_LOCK_KEY);
    },
  };
}

const DEFAULT_STATE: InstallState = {
  status: "idle",
  lockfileHash: null,
  manifest: [],
  totalSizeBytes: 0,
  lastInstalledAt: null,
  errorMessage: null,
};

export function createInstallStateStore(
  db: SafeDatabase<Schema>,
): InstallStateStore {
  async function upsert(
    set: Partial<typeof scriptPackageInstallState.$inferInsert>,
  ): Promise<void> {
    await db
      .insert(scriptPackageInstallState)
      .values({ id: SINGLETON_ID, ...set })
      .onConflictDoUpdate({
        target: scriptPackageInstallState.id,
        set,
      });
  }

  return {
    async load() {
      const rows = await db
        .select()
        .from(scriptPackageInstallState)
        .where(eq(scriptPackageInstallState.id, SINGLETON_ID))
        .limit(1);
      const row = rows[0];
      if (!row) return DEFAULT_STATE;
      return {
        status: row.status as InstallState["status"],
        lockfileHash: row.lockfileHash,
        manifest: row.manifest,
        totalSizeBytes: row.totalSizeBytes,
        lastInstalledAt: row.lastInstalledAt,
        errorMessage: row.errorMessage,
      };
    },

    async setInstalling() {
      await upsert({ status: "installing", errorMessage: null });
    },

    async setReady({ lockfileHash, manifest, totalSizeBytes }) {
      await upsert({
        status: "ready",
        lockfileHash,
        manifest,
        totalSizeBytes,
        lastInstalledAt: new Date(),
        errorMessage: null,
      });
    },

    async setError(message) {
      await upsert({ status: "error", errorMessage: message });
    },
  };
}
