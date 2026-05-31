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
  /**
   * Last heartbeat timestamp — null means never connected (or cleanly
   * disconnected). This is the SINGLE durable liveness source of truth: the
   * reactive `satellite-connection` entity's `status` and `lastSeenAt` are
   * COMPUTED on read from it (via `computeStatus` / `OFFLINE_THRESHOLD_MS`), so
   * the entity is globally consistent from any pod and self-heals — a stale row
   * reads `offline` once this timestamp ages past the offline threshold, even
   * if the pod that owned the socket crashed without writing offline.
   */
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  /** Satellite version reported on connect/heartbeat */
  version: text("version"),
  /**
   * Which lifecycle edge produced the latest connection-status change. Preserves
   * the distinction between a socket drop (`disconnected`) and the heartbeat-lost
   * offline edge (`heartbeat_lost`) that a bare status diff cannot encode. This
   * is the ONLY durable connection column the reactive `satellite-connection`
   * entity needs beyond `lastHeartbeatAt`: the deriver reads it as `lastEvent`,
   * and the heartbeat monitor uses it to make heartbeat-lost detection
   * idempotent (once it is `"heartbeat_lost"`, re-runs are no-ops). Nullable: a
   * satellite that never connected has no last event.
   */
  lastConnectionEvent: text("last_connection_event", {
    enum: ["connected", "disconnected", "heartbeat_lost"],
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
