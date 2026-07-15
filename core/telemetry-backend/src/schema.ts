import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { SourceBinding } from "@checkstack/telemetry-common";

/**
 * Telemetry platform schema. ONE table: configured source instances.
 *
 * FK-less by design (this plugin runs in its own Postgres schema; referenced
 * streams and satellites live in OTHER plugins' schemas, so references are by
 * opaque id and cleanup is by convention - see the metricstream schema for the
 * rationale).
 *
 * SECRET STORAGE: config fields the source type marks `x-secret` NEVER hold
 * plaintext in the `config` jsonb - they hold the marker
 * `__tlsecret__:<sourceId>:<field>`, and the plaintext lives encrypted at rest
 * in the platform's `InternalSecretsService` (the same AES-GCM store the
 * metricstream scrape-target bearer uses). Values are resolved just-in-time
 * before a seam executes and are NEVER returned by reads.
 */
export const telemetrySources = pgTable(
  "telemetry_sources",
  {
    id: text("id").primaryKey(),
    /** Qualified source type id: `${ownerPluginId}.${typeId}`. */
    sourceTypeId: text("source_type_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Non-secret config values + `__tlsecret__` markers. NEVER plaintext secrets. */
    config: jsonb("config").notNull().$type<Record<string, unknown>>(),
    /** `[{ signal, streamId }]` - at most one binding per signal. */
    bindings: jsonb("bindings").notNull().$type<SourceBinding[]>(),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * Pull interval override; null falls back to the type's default. Clamped
     * to the type's `minIntervalSeconds` by the service.
     */
    intervalSeconds: integer("interval_seconds"),
    /**
     * When set, a pull instance executes on this satellite and is EXCLUDED
     * from the core reconciler. Settable only for types declaring
     * `supportsSatellite` (none yet - satellite execution ships with the
     * first satellite-capable source type).
     */
    satelliteId: text("satellite_id"),
    /**
     * sha256 hash of the per-instance webhook secret (webhook-mode types
     * only). Only the hash + display prefix are stored; the secret is shown
     * once at create / rotate.
     */
    webhookSecretHash: text("webhook_secret_hash"),
    webhookSecretPrefix: text("webhook_secret_prefix"),
    /**
     * sha256 hash of the per-instance push bearer token (push-mode types
     * only). Same shown-once/hash-only model as the webhook secret; indexed
     * because the ingest hot path resolves tokens by hash.
     */
    pushTokenHash: text("push_token_hash"),
    pushTokenPrefix: text("push_token_prefix"),
    /** Consecutive pull failures; drives failure surfacing at a threshold. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("telemetry_sources_type_idx").on(t.sourceTypeId),
    index("telemetry_sources_enabled_idx").on(t.enabled),
    index("telemetry_sources_push_hash_idx").on(t.pushTokenHash),
  ],
);

export type TelemetrySourceRow = typeof telemetrySources.$inferSelect;
export type NewTelemetrySourceRow = typeof telemetrySources.$inferInsert;
