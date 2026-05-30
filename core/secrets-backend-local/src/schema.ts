import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Local secret store: AES-256-GCM encrypted values keyed by unique name.
 * Promoted from the GitOps `secrets` table — the gitops migration copies
 * existing rows into this table (see ./drizzle migrations).
 *
 * NEVER expose `encryptedValue` or a decrypted value through any RPC/DTO.
 */
export const secrets = pgTable("secrets", {
  id: text("id").primaryKey(),
  /** Unique name referenced via `${{ secrets.NAME }}`. */
  name: text("name").notNull().unique(),
  /** AES-256-GCM encrypted value (iv:authTag:ciphertext). */
  encryptedValue: text("encrypted_value").notNull(),
  description: text("description"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
