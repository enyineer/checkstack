import { eq } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import type {
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
import {
  scriptPackages,
  scriptPackageRegistryConfig,
  scriptPackageStorageConfig,
  scriptPackageSizeCap,
  scriptPackageBlob,
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
  };
}
