import {
  pgTable,
  text,
  boolean,
  json,
  serial,
  timestamp,
  jsonb,
  primaryKey,
  uuid,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// --- Plugin System Schema ---
export const plugins = pgTable("plugins", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  path: text("path").notNull(),
  isUninstallable: boolean("is_uninstallable").default(false).notNull(),
  config: json("config").default({}),
  enabled: boolean("enabled").default(true).notNull(),
  type: text("type").default("backend").notNull(),
  // ── Runtime plugin system additions ────────────────────────────────────────
  /** Installed version (matches package.json `version`). Empty string for
   *  legacy rows that predate the runtime install system. */
  version: text("version").default("").notNull(),
  /** Full validated `InstallPackageMetadata` snapshot taken at install time. */
  metadata: jsonb("metadata").default({}).notNull(),
  /** The `PluginSource` used to install this plugin (NULL for monorepo-local). */
  source: jsonb("source"),
  /** Groups sibling rows installed together as one bundle. */
  bundleId: uuid("bundle_id"),
  /** True on the primary row of a bundle (the row that declared the bundle). */
  isPrimary: boolean("is_primary").default(false).notNull(),
});

// --- JWT Key Store Schema ---
export const jwtKeys = pgTable("jwt_keys", {
  id: text("id").primaryKey(), // The "kid"
  publicKey: text("public_key").notNull(), // JWK JSON string
  privateKey: text("private_key").notNull(), // Encrypted JWK JSON string (or plain if env is secure)
  algorithm: text("algorithm").notNull(), // e.g. RS256
  createdAt: text("created_at").notNull(), // ISO string
  expiresAt: text("expires_at"), // ISO string, null if indefinite
  revokedAt: text("revoked_at"), // ISO string, null if valid
});

// --- Plugin Configs Schema ---
export const pluginConfigs = pgTable(
  "plugin_configs",
  {
    pluginId: text("plugin_id").notNull(),
    configId: text("config_id").notNull(),
    data: jsonb("data").notNull(), // Stores VersionedConfig with encrypted secrets
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.pluginId, table.configId] }),
  }),
);

// --- Plugin Artifact Store ---
// Tarball bytes for runtime-installed plugins. Shared across all instances
// so a freshly spun replica can recover plugins without re-fetching from
// the original source.
export const pluginArtifacts = pgTable(
  "plugin_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pluginName: text("plugin_name").notNull(),
    version: text("version").notNull(),
    bundleId: uuid("bundle_id"),
    tarball: text("tarball").notNull(), // base64-encoded bytes (drizzle bytea handling is awkward; text is portable)
    contentHash: text("content_hash").notNull(), // sha256 hex
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    pluginNameVersionIdx: uniqueIndex("plugin_artifacts_name_version_idx").on(
      table.pluginName,
      table.version,
    ),
    contentHashIdx: index("plugin_artifacts_content_hash_idx").on(
      table.contentHash,
    ),
  }),
);

// --- Plugin Install Events (audit + reviewable error log) ---
export const pluginInstallEvents = pgTable(
  "plugin_install_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pluginName: text("plugin_name"),
    bundleId: uuid("bundle_id"),
    /** "install" | "uninstall" */
    action: text("action").notNull(),
    /**
     * Phase within action:
     *   "validate" | "persist" | "broadcast" | "in-process-load" |
     *   "in-process-unload" | "destructive-cleanup" | "audit"
     */
    phase: text("phase").notNull(),
    /** "started" | "succeeded" | "failed" */
    status: text("status").notNull(),
    source: jsonb("source"),
    error: text("error"),
    instanceId: text("instance_id").notNull(),
    userId: text("user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    pluginNameCreatedIdx: index("plugin_install_events_name_created_idx").on(
      table.pluginName,
      table.createdAt,
    ),
    statusCreatedIdx: index("plugin_install_events_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
  }),
);
