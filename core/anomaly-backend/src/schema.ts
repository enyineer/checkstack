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
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
});

export const anomalyBaselines = pgTable("anomaly_baselines", {
  id: uuid("id").primaryKey().defaultRandom(),
  systemId: text("system_id").notNull(),
  configurationId: uuid("configuration_id").notNull(),
  fieldPath: text("field_path").notNull(),
  mean: doublePrecision("mean").notNull(),
  stdDev: doublePrecision("std_dev").notNull(),
  trendSlope: doublePrecision("trend_slope").notNull(),
  sampleCount: integer("sample_count").notNull(),
  computedAt: timestamp("computed_at").notNull(),
  dominantValue: text("dominant_value"),
  dominantRatio: doublePrecision("dominant_ratio"),
}, (t) => ({
  uniquePath: unique("anomaly_baselines_unique_path").on(
    t.systemId,
    t.configurationId,
    t.fieldPath
  )
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
