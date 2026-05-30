import { eq, sql } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import type {
  InstallState,
  ManifestEntry,
} from "@checkstack/script-packages-common";
import { scriptPackageInstallState } from "./schema";

/**
 * Singleton install-state persistence + the installer-election advisory
 * lock.
 *
 * Exactly one core instance performs the registry-facing `bun install` at a
 * time, guarded by a Postgres advisory lock. The pattern is copied (not
 * imported) from `automation-backend`'s dispatch run-state store:
 * `pg_try_advisory_lock(hashtextextended(key, 0))`. The lock auto-releases
 * when the holding DB session closes, so a crashed installer never wedges
 * the election.
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
  /** Acquire the installer-election lock. True = this instance installs. */
  tryInstallerLock(): Promise<boolean>;
  releaseInstallerLock(): Promise<void>;
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

    async tryInstallerLock() {
      const result = await db.execute<{ ok: boolean }>(sql`
        SELECT pg_try_advisory_lock(hashtextextended(${INSTALLER_LOCK_KEY}, 0)) AS ok
      `);
      const rows = result as unknown as { rows: Array<{ ok: boolean }> };
      return Boolean(rows.rows?.[0]?.ok);
    },

    async releaseInstallerLock() {
      await db.execute(sql`
        SELECT pg_advisory_unlock(hashtextextended(${INSTALLER_LOCK_KEY}, 0))
      `);
    },
  };
}
