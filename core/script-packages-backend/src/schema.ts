import {
  pgTable,
  text,
  jsonb,
  integer,
  bigint,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import type { ManifestEntry } from "@checkstack/script-packages-common";

/**
 * Drizzle schema for the script-packages plugin.
 *
 * Tables (per the feature plan §3.7). Singleton tables use a fixed text PK
 * (`"singleton"`) so an upsert always targets the one row. Core instances
 * are ephemeral and not individually addressable - they reconcile to the
 * desired `lockfile_hash` without per-pod rows.
 */

/** The admin-curated allowlist of pinned packages. */
export const scriptPackages = pgTable("script_packages", {
  name: text("name").primaryKey(),
  version: text("version").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  addedBy: text("added_by"),
  addedAt: timestamp("added_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Singleton registry config. Auth token is a connection-store secret ref. */
export const scriptPackageRegistryConfig = pgTable(
  "script_package_registry_config",
  {
    id: text("id").primaryKey().default("singleton"),
    registryUrl: text("registry_url")
      .notNull()
      .default("https://registry.npmjs.org/"),
    scopedRegistries: jsonb("scoped_registries")
      .$type<{ scope: string; registryUrl: string }[]>()
      .notNull()
      .default([]),
    /** Secret ref into the connection-store; never the plaintext token. */
    authSecretRef: text("auth_secret_ref"),
    ignoreScripts: boolean("ignore_scripts").notNull().default(true),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);

/** Singleton desired install state + lockfile manifest. */
export const scriptPackageInstallState = pgTable(
  "script_package_install_state",
  {
    id: text("id").primaryKey().default("singleton"),
    /** "idle" | "installing" | "ready" | "error" */
    status: text("status").notNull().default("idle"),
    /** Desired lockfile hash every host reconciles to. */
    lockfileHash: text("lockfile_hash"),
    manifest: jsonb("manifest").$type<ManifestEntry[]>().notNull().default([]),
    totalSizeBytes: bigint("total_size_bytes", { mode: "number" })
      .notNull()
      .default(0),
    lastInstalledAt: timestamp("last_installed_at"),
    errorMessage: text("error_message"),
  },
);

/** Singleton size-cap config (warn / block thresholds). */
export const scriptPackageSizeCap = pgTable("script_package_size_cap", {
  id: text("id").primaryKey().default("singleton"),
  warnBytes: bigint("warn_bytes", { mode: "number" })
    .notNull()
    .default(150 * 1024 * 1024),
  blockBytes: bigint("block_bytes", { mode: "number" })
    .notNull()
    .default(300 * 1024 * 1024),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Content-addressed blob index. `integrity` is the stable identity across
 * blob-store backends; `backend` records which `BlobStore` currently holds
 * it (well-defined during migration). Powers delta sync + blob GC.
 */
export const scriptPackageBlob = pgTable(
  "script_package_blob",
  {
    integrity: text("integrity").primaryKey(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    /** "postgres" | "s3" | ... */
    backend: text("backend").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    backendIdx: index("script_package_blob_backend_idx").on(t.backend),
  }),
);

/** Singleton storage config + in-flight migration state. */
export const scriptPackageStorageConfig = pgTable(
  "script_package_storage_config",
  {
    id: text("id").primaryKey().default("singleton"),
    activeBackend: text("active_backend").notNull().default("postgres"),
    /** "idle" | "migrating" | "completed" | "error" */
    migrationStatus: text("migration_status").notNull().default("idle"),
    migrationTarget: text("migration_target"),
    migratedCount: integer("migrated_count").notNull().default(0),
    migrationError: text("migration_error"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);

/**
 * Recent lockfile-manifest history. The installer records each successful
 * `lockfileHash` + its manifest here so the blob GC can compute the
 * "retained set" (current + the previous N hashes) without that history
 * being reconstructable from the singleton install state (which only holds
 * the CURRENT desired manifest). Old rows beyond the retention window are
 * pruned by the GC itself.
 */
export const scriptPackageLockfileHistory = pgTable(
  "script_package_lockfile_history",
  {
    lockfileHash: text("lockfile_hash").primaryKey(),
    manifest: jsonb("manifest").$type<ManifestEntry[]>().notNull().default([]),
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  },
  (t) => ({
    recordedIdx: index("script_package_lockfile_history_recorded_idx").on(
      t.recordedAt,
    ),
  }),
);

/** Singleton blob-GC last-run state (for the admin UI; never gates safety). */
export const scriptPackageBlobGcState = pgTable(
  "script_package_blob_gc_state",
  {
    id: text("id").primaryKey().default("singleton"),
    lastRunAt: timestamp("last_run_at"),
    lastDeleted: integer("last_deleted").notNull().default(0),
    lastBytesReclaimed: bigint("last_bytes_reclaimed", { mode: "number" })
      .notNull()
      .default(0),
    totalBytesReclaimed: bigint("total_bytes_reclaimed", { mode: "number" })
      .notNull()
      .default(0),
  },
);

/** Per-satellite reconcile state (satellites are individually addressable). */
export const scriptPackageSatelliteState = pgTable(
  "script_package_satellite_state",
  {
    satelliteId: text("satellite_id").primaryKey(),
    lockfileHash: text("lockfile_hash"),
    /** "pending" | "syncing" | "ready" | "error" */
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    syncedAt: timestamp("synced_at"),
  },
);
