import { eq, and, desc } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";
import { anomalySettingsConfig } from "./config";
import type { VersionedRecord } from "@checkstack/backend-api";
import type { AnomalySettings } from "@checkstack/anomaly-common";

export class AnomalyService {
  constructor(private readonly db: SafeDatabase<typeof schema>) {}

  async getAnomalies(params: {
    systemId?: string;
    configurationId?: string;
    state?: schema.AnomalyState;
    limit?: number;
  }) {
    const conditions = [];

    if (params.systemId) {
      conditions.push(eq(schema.anomalies.systemId, params.systemId));
    }
    if (params.configurationId) {
      conditions.push(
        eq(schema.anomalies.configurationId, params.configurationId),
      );
    }
    if (params.state) {
      conditions.push(eq(schema.anomalies.state, params.state));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await this.db
      .select()
      .from(schema.anomalies)
      .where(whereClause)
      .orderBy(desc(schema.anomalies.startedAt))
      .limit(params.limit ?? 50);

    return results.map((r) => ({
      ...r,
      startedAt: r.startedAt.toISOString(),
      // eslint-disable-next-line unicorn/no-null
      confirmedAt: r.confirmedAt?.toISOString() ?? null,
      // eslint-disable-next-line unicorn/no-null
      recoveredAt: r.recoveredAt?.toISOString() ?? null,
    }));
  }

  async getAnomalyBaselines(params: {
    systemId: string;
    configurationId: string;
  }) {
    const results = await this.db
      .select()
      .from(schema.anomalyBaselines)
      .where(
        and(
          eq(schema.anomalyBaselines.systemId, params.systemId),
          eq(schema.anomalyBaselines.configurationId, params.configurationId),
        ),
      );

    return results.map((r) => ({
      ...r,
      computedAt: r.computedAt.toISOString(),
    }));
  }

  async getAnomalyConfig(configurationId: string) {
    const [result] = await this.db
      .select()
      .from(schema.anomalyConfigurations)
      .where(eq(schema.anomalyConfigurations.configurationId, configurationId));

    if (!result) {
      // Return default configuration wrapper
      return anomalySettingsConfig.create({
        enabled: true,
        sensitivity: 1,
        confirmationWindow: 3,
        baselineWindow: "7d",
        notify: true,
      }) as VersionedRecord<AnomalySettings>;
    }

    return result.config as VersionedRecord<AnomalySettings>;
  }

  async updateAnomalyConfig(configurationId: string, configData: unknown) {
    const newConfigRecord = anomalySettingsConfig.create(configData as AnomalySettings);

    const [result] = await this.db
      .insert(schema.anomalyConfigurations)
      .values({
        configurationId,
        config: newConfigRecord,
      })
      .onConflictDoUpdate({
        target: [schema.anomalyConfigurations.configurationId],
        set: { config: newConfigRecord },
      })
      .returning();

    return result!.config;
  }

  async getAnomalyAssignmentConfig(systemId: string, configurationId: string) {
    const [result] = await this.db
      .select()
      .from(schema.anomalyAssignments)
      .where(
        and(
          eq(schema.anomalyAssignments.systemId, systemId),
          eq(schema.anomalyAssignments.configurationId, configurationId),
        ),
      );

    return result ? (result.config as VersionedRecord<Partial<AnomalySettings>>) : undefined;
  }

  async updateAnomalyAssignmentConfig(systemId: string, configurationId: string, configData: unknown) {
    // For assignments, we only store overrides, so we can mock a versioned record with partial data
    // Actually, Versioned<T> requires the full schema unless we define a Versioned<Partial<AnomalySettings>>
    // For now, we will cast it as the data is just JSONB in the DB
    const newConfigRecord = {
      version: anomalySettingsConfig.version,
      data: configData,
    };

    const [result] = await this.db
      .insert(schema.anomalyAssignments)
      .values({
        systemId,
        configurationId,
        config: newConfigRecord,
      })
      .onConflictDoUpdate({
        target: [schema.anomalyAssignments.systemId, schema.anomalyAssignments.configurationId],
        set: { config: newConfigRecord },
      })
      .returning();

    return result!.config;
  }
}
