import {
  pgTable,
  text,
  jsonb,
  uuid,
  integer,
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
  /**
   * Capabilities the satellite last advertised on connect/heartbeat (e.g.
   * "telemetry", "scrape", "log-receivers", "syslog"). Drives capability-aware
   * UI (a scrape target can only bind to a satellite that advertised "scrape")
   * and assignment gating. Empty for a satellite that never advertised any.
   */
  capabilities: jsonb("capabilities").$type<string[]>().default([]).notNull(),
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
  /**
   * How long this satellite may go without a heartbeat before it counts as
   * offline, in milliseconds. NULL means "use the platform default"
   * ({@link OFFLINE_THRESHOLD_MS}), which is what every satellite created
   * before this column existed keeps doing.
   *
   * Per-satellite because tolerance is a property of the LINK, not of the
   * platform: a satellite on a flaky VPN or a metered uplink needs minutes of
   * grace, while one in the same datacentre should be reported offline in
   * seconds. A single global value forces the loosest satellite's tolerance on
   * every other one.
   *
   * Read it wherever `computeStatus` is called - all three readers (the entity
   * read, the admin list, the heartbeat monitor) MUST use the same value or
   * they will disagree about whether the same satellite is online.
   */
  offlineThresholdMs: integer("offline_threshold_ms"),
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
