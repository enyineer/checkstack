import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";

/** Enum for GitOps provider types. */
export const providerTypeEnum = pgEnum("provider_type", ["github", "gitlab"]);

/** Enum for deletion policy when descriptors disappear from git. */
export const deletionPolicyEnum = pgEnum("deletion_policy", [
  "orphan",
  "auto",
]);

/** Enum for provenance sync status. */
export const provenanceStatusEnum = pgEnum("provenance_status", [
  "synced",
  "error",
  "orphaned",
]);

/** GitOps provider configurations (GitHub, GitLab, etc.) */
export const providers = pgTable("providers", {
  id: text("id").primaryKey(),
  type: providerTypeEnum("type").notNull(),
  target: text("target").notNull(), // "my-org" or "my-org/my-repo"
  pathPattern: text("path_pattern").notNull(), // e.g., ".checkstack/**/*.yaml"
  /** Encrypted auth token (DynamicForm secret field). */
  authToken: text("auth_token"),
  /** Custom API base URL for enterprise/on-prem installations (e.g., "https://github.example.com/api/v3"). */
  baseUrl: text("base_url"),
  /** Sync interval in seconds. */
  syncInterval: integer("sync_interval").notNull().default(300),
  deletionPolicy: deletionPolicyEnum("deletion_policy")
    .notNull()
    .default("orphan"),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncError: text("last_sync_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Provenance tracking for GitOps-managed entities. */
export const provenance = pgTable("provenance", {
  id: text("id").primaryKey(),
  apiVersion: text("api_version").notNull(),
  kind: text("kind").notNull(),
  entityName: text("entity_name").notNull(),
  /** Plugin-specific entity ID (e.g., catalog system UUID). Set by the reconciler engine. */
  entityId: text("entity_id").notNull(),
  providerId: text("provider_id")
    .notNull()
    .references(() => providers.id, { onDelete: "cascade" }),
  repository: text("repository").notNull(),
  filePath: text("file_path").notNull(),
  lastSyncHash: text("last_sync_hash").notNull(),
  status: provenanceStatusEnum("status").notNull().default("synced"),
  errorMessage: text("error_message"),
  lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Secret store for secretRef values in YAML descriptors. */
export const secrets = pgTable("secrets", {
  id: text("id").primaryKey(),
  /** Unique name referenced by secretRef in descriptors. */
  name: text("name").notNull().unique(),
  /** AES-256-GCM encrypted value (format: iv:authTag:ciphertext). */
  encryptedValue: text("encrypted_value").notNull(),
  description: text("description"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
