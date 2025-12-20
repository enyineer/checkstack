import { pgTable, text, boolean, json, serial } from "drizzle-orm/pg-core";

// --- Plugin System Schema ---
export const plugins = pgTable("plugins", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  path: text("path").notNull(),
  isUninstallable: boolean("is_uninstallable").default(false).notNull(),
  config: json("config").default({}),
  enabled: boolean("enabled").default(true).notNull(),
  type: text("type").default("backend").notNull(),
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
