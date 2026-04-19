import {
  pgTable,
  text,
  jsonb,
  uuid,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Satellites table — each record represents a registered satellite node.
 * tokenHash stores a bcrypt hash of the pre-shared API token.
 * The satellite's UUID (id) serves as the clientId for authentication.
 */
export const satellites = pgTable("satellites", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  /** Key-value tags for flexible grouping and filtering */
  tags: jsonb("tags").$type<Record<string, string>>().default({}).notNull(),
  /** Bcrypt hash of the satellite's API token */
  tokenHash: text("token_hash").notNull(),
  /** Last heartbeat timestamp — null means never connected */
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  /** Satellite version reported on connect/heartbeat */
  version: text("version"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
