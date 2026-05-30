import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Name → Vault location index, owned by the Vault backend (its own
 * Postgres schema). Maps a platform secret `name` (referenced via
 * `${{ secrets.NAME }}`) to the KV v2 path + key it lives at in Vault.
 *
 * This table defines the available secret-name set for the active Vault
 * backend (the admin UI + `listSecretNames` read from it). It holds NO
 * secret values — only the locator + metadata.
 */
export const secretIndex = pgTable("secret_index", {
  id: text("id").primaryKey(),
  /** Unique platform name, referenced via `${{ secrets.NAME }}`. */
  name: text("name").notNull().unique(),
  /** KV v2 secret path within the mount, e.g. "myapp/db". */
  vaultPath: text("vault_path").notNull(),
  /** Key within the KV v2 secret's data object, e.g. "password". */
  vaultKey: text("vault_key").notNull(),
  description: text("description"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
