import { eq, ne, desc, sql } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import type {
  BlobGcState,
  ManifestEntry,
  PackageSpec,
  RegistryConfig,
  SatelliteSyncState,
  SizeCapConfig,
  StorageConfig,
} from "@checkstack/script-packages-common";
import {
  DEFAULT_BLOCK_BYTES,
  DEFAULT_WARN_BYTES,
} from "@checkstack/script-packages-common";
import type { GcBlob } from "./blob-gc";
import {
  scriptPackages,
  scriptPackageRegistryConfig,
  scriptPackageStorageConfig,
  scriptPackageSizeCap,
  scriptPackageBlob,
  scriptPackageBlobGcState,
  scriptPackageLockfileHistory,
  scriptPackageSatelliteState,
} from "./schema";

const SINGLETON = "singleton";

// ─── Allowlist store ───────────────────────────────────────────────────────

type AllowlistSchema = { scriptPackages: typeof scriptPackages };

export function createPackageStore(db: SafeDatabase<AllowlistSchema>) {
  return {
    async list(): Promise<PackageSpec[]> {
      const rows = await db.select().from(scriptPackages);
      return rows
        .map((r) => ({
          name: r.name,
          version: r.version,
          enabled: r.enabled,
          addedBy: r.addedBy,
          addedAt: r.addedAt,
          updatedAt: r.updatedAt,
        }))
        .toSorted((a, b) => a.name.localeCompare(b.name));
    },
    async upsert(input: {
      name: string;
      version: string;
      addedBy?: string | null;
    }): Promise<PackageSpec> {
      const now = new Date();
      await db
        .insert(scriptPackages)
        .values({
          name: input.name,
          version: input.version,
          addedBy: input.addedBy ?? null,
          enabled: true,
        })
        .onConflictDoUpdate({
          target: scriptPackages.name,
          set: { version: input.version, updatedAt: now },
        });
      const [row] = await db
        .select()
        .from(scriptPackages)
        .where(eq(scriptPackages.name, input.name))
        .limit(1);
      return {
        name: row!.name,
        version: row!.version,
        enabled: row!.enabled,
        addedBy: row!.addedBy,
        addedAt: row!.addedAt,
        updatedAt: row!.updatedAt,
      };
    },
    async remove(name: string): Promise<void> {
      await db.delete(scriptPackages).where(eq(scriptPackages.name, name));
    },
    async setEnabled(input: {
      name: string;
      enabled: boolean;
    }): Promise<PackageSpec> {
      await db
        .update(scriptPackages)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(eq(scriptPackages.name, input.name));
      const [row] = await db
        .select()
        .from(scriptPackages)
        .where(eq(scriptPackages.name, input.name))
        .limit(1);
      return {
        name: row!.name,
        version: row!.version,
        enabled: row!.enabled,
        addedBy: row!.addedBy,
        addedAt: row!.addedAt,
        updatedAt: row!.updatedAt,
      };
    },
  };
}

// ─── Registry config store ───────────────────────────────────────────────

type RegistrySchema = {
  scriptPackageRegistryConfig: typeof scriptPackageRegistryConfig;
};

export function createRegistryConfigStore(db: SafeDatabase<RegistrySchema>) {
  return {
    /** DTO view (no token); use `authSecretRef()` for the secret ref. */
    async get(): Promise<RegistryConfig> {
      const [row] = await db
        .select()
        .from(scriptPackageRegistryConfig)
        .where(eq(scriptPackageRegistryConfig.id, SINGLETON))
        .limit(1);
      if (!row) {
        return {
          registryUrl: "https://registry.npmjs.org/",
          scopedRegistries: [],
          hasAuthToken: false,
          ignoreScripts: true,
        };
      }
      return {
        registryUrl: row.registryUrl,
        scopedRegistries: row.scopedRegistries,
        hasAuthToken: Boolean(row.authSecretRef),
        ignoreScripts: row.ignoreScripts,
        updatedAt: row.updatedAt,
      };
    },
    async authSecretRef(): Promise<string | null> {
      const [row] = await db
        .select({ ref: scriptPackageRegistryConfig.authSecretRef })
        .from(scriptPackageRegistryConfig)
        .where(eq(scriptPackageRegistryConfig.id, SINGLETON))
        .limit(1);
      return row?.ref ?? null;
    },
    async set(input: {
      registryUrl: string;
      scopedRegistries: { scope: string; registryUrl: string }[];
      ignoreScripts: boolean;
      /** Pass to set; undefined leaves untouched; null clears. */
      authSecretRef?: string | null;
    }): Promise<void> {
      const set: Record<string, unknown> = {
        registryUrl: input.registryUrl,
        scopedRegistries: input.scopedRegistries,
        ignoreScripts: input.ignoreScripts,
        updatedAt: new Date(),
      };
      if (input.authSecretRef !== undefined) {
        set.authSecretRef = input.authSecretRef;
      }
      await db
        .insert(scriptPackageRegistryConfig)
        .values({ id: SINGLETON, ...set })
        .onConflictDoUpdate({
          target: scriptPackageRegistryConfig.id,
          set,
        });
    },
  };
}

// ─── Storage config store ────────────────────────────────────────────────

type StorageSchema = {
  scriptPackageStorageConfig: typeof scriptPackageStorageConfig;
};

export function createStorageConfigStore(db: SafeDatabase<StorageSchema>) {
  return {
    async get(): Promise<StorageConfig> {
      const [row] = await db
        .select()
        .from(scriptPackageStorageConfig)
        .where(eq(scriptPackageStorageConfig.id, SINGLETON))
        .limit(1);
      if (!row) {
        return {
          activeBackend: "postgres",
          migrationStatus: "idle",
          migrationTarget: null,
          migratedCount: 0,
          migrationError: null,
        };
      }
      return {
        activeBackend: row.activeBackend,
        migrationStatus: row.migrationStatus as StorageConfig["migrationStatus"],
        migrationTarget: row.migrationTarget,
        migratedCount: row.migratedCount,
        migrationError: row.migrationError,
        updatedAt: row.updatedAt,
      };
    },
    async setActiveBackend(backend: string): Promise<void> {
      const set = { activeBackend: backend, updatedAt: new Date() };
      await db
        .insert(scriptPackageStorageConfig)
        .values({ id: SINGLETON, ...set })
        .onConflictDoUpdate({
          target: scriptPackageStorageConfig.id,
          set,
        });
    },
    /** Mark a migration as started (idempotent; resets count + error). */
    async beginMigration(target: string): Promise<void> {
      const set = {
        migrationStatus: "migrating" as const,
        migrationTarget: target,
        migratedCount: 0,
        migrationError: null,
        updatedAt: new Date(),
      };
      await db
        .insert(scriptPackageStorageConfig)
        .values({ id: SINGLETON, ...set })
        .onConflictDoUpdate({ target: scriptPackageStorageConfig.id, set });
    },
    /** Update the migrated-blob counter (progress). */
    async setMigratedCount(count: number): Promise<void> {
      await db
        .update(scriptPackageStorageConfig)
        .set({ migratedCount: count, updatedAt: new Date() })
        .where(eq(scriptPackageStorageConfig.id, SINGLETON));
    },
    /**
     * Atomically complete a migration: flip the active backend to the target
     * and mark completed. Done in one UPDATE so a reader never sees a
     * "completed but old active backend" state.
     */
    async completeMigration(target: string): Promise<void> {
      await db
        .update(scriptPackageStorageConfig)
        .set({
          activeBackend: target,
          migrationStatus: "completed",
          migrationError: null,
          updatedAt: new Date(),
        })
        .where(eq(scriptPackageStorageConfig.id, SINGLETON));
    },
    /** Record a migration failure (leaves the active backend unchanged). */
    async failMigration(message: string): Promise<void> {
      await db
        .update(scriptPackageStorageConfig)
        .set({
          migrationStatus: "error",
          migrationError: message,
          updatedAt: new Date(),
        })
        .where(eq(scriptPackageStorageConfig.id, SINGLETON));
    },
  };
}

// ─── Size-cap store ────────────────────────────────────────────────────────

type SizeCapSchema = { scriptPackageSizeCap: typeof scriptPackageSizeCap };

export function createSizeCapStore(db: SafeDatabase<SizeCapSchema>) {
  return {
    async get(): Promise<SizeCapConfig> {
      const [row] = await db
        .select()
        .from(scriptPackageSizeCap)
        .where(eq(scriptPackageSizeCap.id, SINGLETON))
        .limit(1);
      return {
        warnBytes: row?.warnBytes ?? DEFAULT_WARN_BYTES,
        blockBytes: row?.blockBytes ?? DEFAULT_BLOCK_BYTES,
      };
    },
    async set(cap: SizeCapConfig): Promise<void> {
      const set = {
        warnBytes: cap.warnBytes,
        blockBytes: cap.blockBytes,
        updatedAt: new Date(),
      };
      await db
        .insert(scriptPackageSizeCap)
        .values({ id: SINGLETON, ...set })
        .onConflictDoUpdate({ target: scriptPackageSizeCap.id, set });
    },
  };
}

// ─── Blob index store ──────────────────────────────────────────────────────

type BlobIndexSchema = { scriptPackageBlob: typeof scriptPackageBlob };

export function createBlobIndexStore(db: SafeDatabase<BlobIndexSchema>) {
  return {
    async record(input: {
      integrity: string;
      name: string;
      version: string;
      backend: string;
      sizeBytes: number;
    }): Promise<void> {
      await db
        .insert(scriptPackageBlob)
        .values(input)
        .onConflictDoUpdate({
          target: scriptPackageBlob.integrity,
          set: { backend: input.backend, sizeBytes: input.sizeBytes },
        });
    },
    async backendFor(integrity: string): Promise<string | undefined> {
      const [row] = await db
        .select({ backend: scriptPackageBlob.backend })
        .from(scriptPackageBlob)
        .where(eq(scriptPackageBlob.integrity, integrity))
        .limit(1);
      return row?.backend;
    },
    /** All indexed blobs (integrity + current backend). */
    async list(): Promise<{ integrity: string; backend: string }[]> {
      const rows = await db
        .select({
          integrity: scriptPackageBlob.integrity,
          backend: scriptPackageBlob.backend,
        })
        .from(scriptPackageBlob);
      return rows;
    },
    /**
     * Blobs whose recorded backend is NOT `target` - the work set for a
     * migration to `target`. Resumability: a resumed migration re-derives
     * this set, so blobs already flipped to `target` are skipped.
     */
    async listNotOnBackend(
      target: string,
    ): Promise<{ integrity: string; backend: string }[]> {
      const rows = await db
        .select({
          integrity: scriptPackageBlob.integrity,
          backend: scriptPackageBlob.backend,
        })
        .from(scriptPackageBlob)
        .where(ne(scriptPackageBlob.backend, target));
      return rows;
    },
    /** Flip a blob's recorded backend after a verified copy. */
    async setBackend(integrity: string, backend: string): Promise<void> {
      await db
        .update(scriptPackageBlob)
        .set({ backend })
        .where(eq(scriptPackageBlob.integrity, integrity));
    },
    /** Every indexed blob with the metadata the GC needs (size + created_at). */
    async listWithMeta(): Promise<GcBlob[]> {
      const rows = await db
        .select({
          integrity: scriptPackageBlob.integrity,
          backend: scriptPackageBlob.backend,
          sizeBytes: scriptPackageBlob.sizeBytes,
          createdAt: scriptPackageBlob.createdAt,
        })
        .from(scriptPackageBlob);
      return rows;
    },
    /** Remove the index row for a GC'd blob (after deleting its bytes). */
    async remove(integrity: string): Promise<void> {
      await db
        .delete(scriptPackageBlob)
        .where(eq(scriptPackageBlob.integrity, integrity));
    },
  };
}

// ─── Lockfile history store ──────────────────────────────────────────────────

type LockfileHistorySchema = {
  scriptPackageLockfileHistory: typeof scriptPackageLockfileHistory;
};

export function createLockfileHistoryStore(
  db: SafeDatabase<LockfileHistorySchema>,
) {
  return {
    /** Record a successful install's manifest (idempotent on hash). */
    async record(input: {
      lockfileHash: string;
      manifest: ManifestEntry[];
    }): Promise<void> {
      await db
        .insert(scriptPackageLockfileHistory)
        .values({
          lockfileHash: input.lockfileHash,
          manifest: input.manifest,
          recordedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: scriptPackageLockfileHistory.lockfileHash,
          // Re-installing the same hash refreshes its recency so it stays in
          // the retained window.
          set: { recordedAt: new Date() },
        });
    },
    /** Manifests for the most-recent `limit` hashes (newest first). */
    async recent(limit: number): Promise<ManifestEntry[][]> {
      const rows = await db
        .select({ manifest: scriptPackageLockfileHistory.manifest })
        .from(scriptPackageLockfileHistory)
        .orderBy(desc(scriptPackageLockfileHistory.recordedAt))
        .limit(limit);
      return rows.map((r) => r.manifest);
    },
    /** Hashes to keep (the most-recent `limit`); used to prune the rest. */
    async retainedHashes(limit: number): Promise<string[]> {
      const rows = await db
        .select({ lockfileHash: scriptPackageLockfileHistory.lockfileHash })
        .from(scriptPackageLockfileHistory)
        .orderBy(desc(scriptPackageLockfileHistory.recordedAt))
        .limit(limit);
      return rows.map((r) => r.lockfileHash);
    },
    /** Prune history rows older than the most-recent `keep` hashes. */
    async pruneOlderThan(keep: number): Promise<void> {
      const keepHashes = await this.retainedHashes(keep);
      if (keepHashes.length === 0) return;
      await db
        .delete(scriptPackageLockfileHistory)
        .where(
          sql`${scriptPackageLockfileHistory.lockfileHash} NOT IN (${sql.join(
            keepHashes.map((h) => sql`${h}`),
            sql`, `,
          )})`,
        );
    },
  };
}

// ─── Blob-GC state store ─────────────────────────────────────────────────────

type BlobGcStateSchema = {
  scriptPackageBlobGcState: typeof scriptPackageBlobGcState;
};

export function createBlobGcStateStore(db: SafeDatabase<BlobGcStateSchema>) {
  return {
    async get(): Promise<BlobGcState> {
      const [row] = await db
        .select()
        .from(scriptPackageBlobGcState)
        .where(eq(scriptPackageBlobGcState.id, SINGLETON))
        .limit(1);
      return {
        lastRunAt: row?.lastRunAt ?? null,
        lastDeleted: row?.lastDeleted ?? 0,
        lastBytesReclaimed: row?.lastBytesReclaimed ?? 0,
        totalBytesReclaimed: row?.totalBytesReclaimed ?? 0,
      };
    },
    /** Record a completed run, accumulating total reclaimed bytes. */
    async recordRun(input: {
      deleted: number;
      bytesReclaimed: number;
    }): Promise<void> {
      await db
        .insert(scriptPackageBlobGcState)
        .values({
          id: SINGLETON,
          lastRunAt: new Date(),
          lastDeleted: input.deleted,
          lastBytesReclaimed: input.bytesReclaimed,
          totalBytesReclaimed: input.bytesReclaimed,
        })
        .onConflictDoUpdate({
          target: scriptPackageBlobGcState.id,
          set: {
            lastRunAt: new Date(),
            lastDeleted: input.deleted,
            lastBytesReclaimed: input.bytesReclaimed,
            totalBytesReclaimed: sql`${scriptPackageBlobGcState.totalBytesReclaimed} + ${input.bytesReclaimed}`,
          },
        });
    },
  };
}

// ─── Satellite sync state store ────────────────────────────────────────────

type SatelliteSchema = {
  scriptPackageSatelliteState: typeof scriptPackageSatelliteState;
};

export function createSatelliteStateStore(db: SafeDatabase<SatelliteSchema>) {
  return {
    async list(): Promise<SatelliteSyncState[]> {
      const rows = await db.select().from(scriptPackageSatelliteState);
      return rows.map((r) => ({
        satelliteId: r.satelliteId,
        lockfileHash: r.lockfileHash,
        status: r.status as SatelliteSyncState["status"],
        errorMessage: r.errorMessage,
        syncedAt: r.syncedAt,
      }));
    },
    async report(input: {
      satelliteId: string;
      lockfileHash: string | null;
      status: SatelliteSyncState["status"];
      errorMessage?: string | null;
    }): Promise<void> {
      const set = {
        lockfileHash: input.lockfileHash,
        status: input.status,
        errorMessage: input.errorMessage ?? null,
        syncedAt: new Date(),
      };
      await db
        .insert(scriptPackageSatelliteState)
        .values({ satelliteId: input.satelliteId, ...set })
        .onConflictDoUpdate({
          target: scriptPackageSatelliteState.satelliteId,
          set,
        });
    },
  };
}
