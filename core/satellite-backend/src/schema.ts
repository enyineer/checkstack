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
  /**
   * Durable, globally-readable current connection status backing the reactive
   * `satellite-connection` entity (reactive automation engine §10.6, §9.1).
   * The pod physically holding the satellite's socket writes this; any other
   * pod reads it for scope enrichment / `wait_until` re-eval. "offline" by
   * default (a freshly-created satellite has never connected).
   */
  connectionStatus: text("connection_status", { enum: ["online", "offline"] })
    .default("offline")
    .notNull(),
  /** ISO instant of the lifecycle edge that last touched the connection (nullable: never connected). */
  lastSeenAt: timestamp("last_seen_at"),
  /**
   * Which lifecycle edge produced the latest connection-status change. Preserves
   * the distinction between a socket drop (`disconnected`) and the heartbeat-lost
   * offline edge (`heartbeat_lost`) that a bare status diff cannot encode.
   * Nullable: a satellite that never connected has no last event.
   */
  lastConnectionEvent: text("last_connection_event", {
    enum: ["connected", "disconnected", "heartbeat_lost"],
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
