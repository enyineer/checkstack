import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  jsonb,
  integer,
  uuid,
  timestamp,
  doublePrecision,
  unique,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const anomalyStateEnum = pgEnum("anomaly_state", [
  "suspicious",
  "anomaly",
  "recovered",
]);

export type AnomalyState = (typeof anomalyStateEnum.enumValues)[number];

export const anomalyDirectionEnum = pgEnum("anomaly_direction", [
  "above",
  "below",
  "changed",
]);

export type AnomalyDirection = (typeof anomalyDirectionEnum.enumValues)[number];

export const anomalyKindEnum = pgEnum("anomaly_kind", ["spike", "drift"]);
export type AnomalyKind = (typeof anomalyKindEnum.enumValues)[number];

export const anomalies = pgTable("anomalies", {
  id: uuid("id").primaryKey().defaultRandom(),
  systemId: text("system_id").notNull(),
  /**
   * Refers to the health check configuration ID that triggered this anomaly.
   * Together with systemId, this maps to the specific health check assignment.
   */
  configurationId: uuid("configuration_id").notNull(),
  /**
   * Environment this anomaly was detected for (per-environment fan-out).
   * null = the env-less slice (no environment membership), mirroring
   * `anomaly_baselines.environmentId` and `health_check_runs.environmentId`.
   * An anomaly for check X in environment A is a distinct row from the same
   * check in environment B: the inline detector and the drift evaluator both
   * locate/create the open row by
   * `(systemId, configurationId, environmentId, fieldPath, kind)`, so a healthy
   * value in one env never masks (or merges with) an anomaly in another.
   *
   * No unique constraint is placed on this table (and none existed before):
   * multiple rows legitimately share the tuple - a `recovered` historical row
   * coexists with a fresh active row - so uniqueness would break the state
   * machine. Pre-feature rows backfill to null (the env-less slice).
   */
  environmentId: text("environment_id"),
  fieldPath: text("field_path").notNull(),
  kind: anomalyKindEnum("kind").default("spike").notNull(),
  state: anomalyStateEnum("state").notNull(),
  direction: anomalyDirectionEnum("direction").notNull(),
  baselineValue: doublePrecision("baseline_value"),
  baselineStdDev: doublePrecision("baseline_std_dev"),
  observedValue: text("observed_value").notNull(),
  deviation: doublePrecision("deviation").notNull(),
  suspiciousRunCount: integer("suspicious_run_count").default(0).notNull(),
  confirmationThreshold: integer("confirmation_threshold").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  confirmedAt: timestamp("confirmed_at"),
  recoveredAt: timestamp("recovered_at"),
  /**
   * Global (per-row) suppression. We model suppression as a flag layered on top
   * of `state` rather than a new `suppressed` enum value: the existing
   * suspicious/anomaly/recovered state machine (in both the spike detector and
   * the drift evaluator) stays intact, and un-suppressing simply reveals the
   * underlying state again. A NULL `suppressedAt` means "not suppressed".
   *
   * Lives on the shared `anomalies` row (Postgres) so every horizontally-scaled
   * pod reads the same suppressed/active set — see state-and-scale.md. The
   * snapshot columns capture the value/baseline at suppression time so the
   * inline detector can auto-unsuppress once the metric "changes again".
   */
  suppressedAt: timestamp("suppressed_at"),
  suppressedValue: doublePrecision("suppressed_value"),
  suppressedBaseline: doublePrecision("suppressed_baseline"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
}, (t) => ({
  // Serves the inline detector's per-run open-row lookup by
  // (systemId, configurationId, environmentId, kind) — runs once per
  // health-check run, the hottest anomaly path.
  openLookupIdx: index("anomalies_open_lookup_idx").on(
    t.systemId,
    t.configurationId,
    t.environmentId,
    t.kind,
  ),
  // Serves the dashboard active-signal scan (non-suppressed rows, newest
  // first) so it uses the partial index instead of a full table scan.
  activeStartedIdx: index("anomalies_active_started_idx")
    .on(t.startedAt.desc())
    .where(sql`${t.suppressedAt} IS NULL`),
}));

export const anomalyBaselines = pgTable("anomaly_baselines", {
  id: uuid("id").primaryKey().defaultRandom(),
  systemId: text("system_id").notNull(),
  configurationId: uuid("configuration_id").notNull(),
  /**
   * Environment this baseline was computed for (per-environment fan-out).
   * null = the env-less slice (the pre-feature cross-env baseline), mirroring
   * `health_check_runs.environmentId`. `nullsNotDistinct()` on the unique
   * constraint below means "one baseline per (system, config, null env, path)"
   * — so the env-less slice stays a single row.
   */
  environmentId: text("environment_id"),
  fieldPath: text("field_path").notNull(),
  mean: doublePrecision("mean").notNull(),
  stdDev: doublePrecision("std_dev").notNull(),
  trendSlope: doublePrecision("trend_slope").notNull(),
  sampleCount: integer("sample_count").notNull(),
  computedAt: timestamp("computed_at").notNull(),
  dominantValue: text("dominant_value"),
  dominantRatio: doublePrecision("dominant_ratio"),
}, (t) => ({
  uniquePath: unique("anomaly_baselines_unique_path")
    .on(t.systemId, t.configurationId, t.environmentId, t.fieldPath)
    .nullsNotDistinct(),
}));

export const anomalyConfigurations = pgTable("anomaly_configurations", {
  configurationId: uuid("configuration_id").primaryKey(),
  config: jsonb("config").notNull(), // VersionedRecord<AnomalySettings>
});

export const anomalyAssignments = pgTable("anomaly_assignments", {
  systemId: text("system_id").notNull(),
  configurationId: uuid("configuration_id").notNull(),
  config: jsonb("config").notNull(), // VersionedRecord<Partial<AnomalySettings>>
}, (t) => ({
  pk: unique("anomaly_assignments_pk").on(t.systemId, t.configurationId),
}));

/**
 * Per-user mute records for anomaly notifications. A row's existence means
 * the user has muted notifications for that (system, fieldPath) pair.
 *
 * Empty fieldPath ("") represents a system-wide mute — anomaly notifications
 * for the entire system are suppressed for that user. We collapse the two
 * granularities into one table so dispatch can answer "is this user muted?"
 * with a single index lookup instead of two queries.
 */
export const anomalyNotificationMutes = pgTable(
  "anomaly_notification_mutes",
  {
    userId: text("user_id").notNull(),
    systemId: text("system_id").notNull(),
    fieldPath: text("field_path").notNull(),
    mutedAt: timestamp("muted_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.systemId, t.fieldPath] }),
    userIdx: index("anomaly_notification_mutes_user_idx").on(t.userId),
    systemIdx: index("anomaly_notification_mutes_system_idx").on(t.systemId),
  }),
);
