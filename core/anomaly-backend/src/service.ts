import { eq, and, desc, inArray } from "drizzle-orm";
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
    kind?: schema.AnomalyKind;
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
    if (params.kind) {
      conditions.push(eq(schema.anomalies.kind, params.kind));
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
       
      confirmedAt: r.confirmedAt?.toISOString() ?? null,
       
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

  async getAnomalyConfig(
    configurationId: string,
  ): Promise<VersionedRecord<AnomalySettings>> {
    const [result] = await this.db
      .select()
      .from(schema.anomalyConfigurations)
      .where(eq(schema.anomalyConfigurations.configurationId, configurationId));

    if (!result) {
      // Return default configuration wrapper
      return anomalySettingsConfig.create({
        enabled: true,
        baselineWindow: "7d",
        notify: true,
      });
    }

    return result.config as VersionedRecord<AnomalySettings>;
  }

  async updateAnomalyConfig(
    configurationId: string,
    configData: AnomalySettings,
  ) {
    const newConfigRecord = anomalySettingsConfig.create(configData);

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

    return result
      ? (result.config as VersionedRecord<Partial<AnomalySettings>>)
      : undefined;
  }

  async updateAnomalyAssignmentConfig(
    systemId: string,
    configurationId: string,
    configData: Partial<AnomalySettings>,
  ) {
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
        target: [
          schema.anomalyAssignments.systemId,
          schema.anomalyAssignments.configurationId,
        ],
        set: { config: newConfigRecord },
      })
      .returning();

    return result.config;
  }

  /**
   * List anomaly-notification mutes for a user. Optionally narrow to one
   * system. Returns the same shape as the DTO (mutedAt is ISO-formatted).
   */
  async listMutes({
    userId,
    systemId,
  }: {
    userId: string;
    systemId?: string;
  }) {
    const conditions = [eq(schema.anomalyNotificationMutes.userId, userId)];
    if (systemId !== undefined) {
      conditions.push(eq(schema.anomalyNotificationMutes.systemId, systemId));
    }

    const rows = await this.db
      .select()
      .from(schema.anomalyNotificationMutes)
      .where(and(...conditions));

    return rows.map((r) => ({
      systemId: r.systemId,
      fieldPath: r.fieldPath,
      mutedAt: r.mutedAt.toISOString(),
    }));
  }

  async addMute({
    userId,
    systemId,
    fieldPath,
  }: {
    userId: string;
    systemId: string;
    fieldPath: string;
  }) {
    await this.db
      .insert(schema.anomalyNotificationMutes)
      .values({ userId, systemId, fieldPath })
      .onConflictDoNothing();
  }

  async removeMute({
    userId,
    systemId,
    fieldPath,
  }: {
    userId: string;
    systemId: string;
    fieldPath: string;
  }) {
    await this.db
      .delete(schema.anomalyNotificationMutes)
      .where(
        and(
          eq(schema.anomalyNotificationMutes.userId, userId),
          eq(schema.anomalyNotificationMutes.systemId, systemId),
          eq(schema.anomalyNotificationMutes.fieldPath, fieldPath),
        ),
      );
  }

  /**
   * For a given (system, fieldPath), return the set of userIds that have
   * muted notifications. A row with empty fieldPath ("") for the system
   * counts as a mute regardless of which field triggered the dispatch.
   * Used by the notification dispatcher to populate `excludeUserIds`.
   *
   * `candidateUserIds` is optional — when omitted, returns every user
   * that ever muted this (system, field). The notification backend
   * intersects against actual subscribers anyway, so a broader exclude
   * set is harmless.
   */
  async getMutedUserIds({
    systemId,
    fieldPath,
    candidateUserIds,
  }: {
    systemId: string;
    fieldPath: string;
    candidateUserIds?: string[];
  }): Promise<Set<string>> {
    const conditions = [
      eq(schema.anomalyNotificationMutes.systemId, systemId),
      inArray(schema.anomalyNotificationMutes.fieldPath, [fieldPath, ""]),
    ];
    if (candidateUserIds !== undefined) {
      if (candidateUserIds.length === 0) return new Set();
      conditions.push(
        inArray(schema.anomalyNotificationMutes.userId, candidateUserIds),
      );
    }

    const rows = await this.db
      .select({ userId: schema.anomalyNotificationMutes.userId })
      .from(schema.anomalyNotificationMutes)
      .where(and(...conditions));

    return new Set(rows.map((r) => r.userId));
  }
}
