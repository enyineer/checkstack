import { eq, and, desc, inArray, isNull, isNotNull, or } from "drizzle-orm";
import type { SafeDatabase, ScopedQueryRunner } from "@checkstack/backend-api";
import * as schema from "./schema";
import {
  anomalySettingsConfig,
  anomalyAssignmentConfig,
  toVersionedRecord,
} from "./config";
import type { VersionedRecord } from "@checkstack/backend-api";
import type {
  AnomalySettings,
  PartialAnomalySettings,
} from "@checkstack/anomaly-common";

/**
 * Composite map key for an assignment's (systemId, configurationId) pair.
 * `JSON.stringify` keeps the two ids unambiguously separated so no id value can
 * collide with the join. Shared by the batch assignment-config loader and its
 * callers.
 */
export function anomalyAssignmentKey(
  systemId: string,
  configurationId: string,
): string {
  return JSON.stringify([systemId, configurationId]);
}

export class AnomalyService {
  constructor(private readonly db: SafeDatabase<typeof schema>) {}

  async getAnomalies(params: {
    systemId?: string;
    configurationId?: string;
    state?: schema.AnomalyState;
    kind?: schema.AnomalyKind;
    /**
     * Optional environment filter. Mirrors the proc input tristate (identical
     * to {@link getAnomalyBaselines}):
     * - `undefined` -> no env predicate (return every env for the given
     *   filters, e.g. the widget's cross-env feed).
     * - `null` -> only the env-less slice (environment_id IS NULL).
     * - a string -> only that environment's anomalies.
     */
    environmentId?: string | null;
    /**
     * Suppression filter. Defaults to "active": suppressed rows are excluded
     * from the active view. Pass "suppressed" to list only suppressed rows, or
     * "all" to ignore the suppression flag entirely.
     */
    suppression?: "active" | "suppressed" | "all";
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
    if (params.environmentId !== undefined) {
      conditions.push(
        params.environmentId === null
          ? isNull(schema.anomalies.environmentId)
          : eq(schema.anomalies.environmentId, params.environmentId),
      );
    }
    if (params.state) {
      conditions.push(eq(schema.anomalies.state, params.state));
    }
    if (params.kind) {
      conditions.push(eq(schema.anomalies.kind, params.kind));
    }

    const suppression = params.suppression ?? "active";
    if (suppression === "active") {
      conditions.push(isNull(schema.anomalies.suppressedAt));
    } else if (suppression === "suppressed") {
      conditions.push(isNotNull(schema.anomalies.suppressedAt));
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

      suppressedAt: r.suppressedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Return the current "problem" anomaly rows across ALL systems, for the
   * dashboard `system.issues` aggregator. Mirrors the frontend filler's two
   * active queries (state = anomaly | suspicious, suppressed rows excluded) in a
   * single global read so the backend signals match the frontend ones. Reads
   * from shared, durable storage so every pod returns the same answer.
   */
  async getActiveSignalAnomalies(): Promise<
    Array<{
      systemId: string;
      configurationId: string;
      environmentId: string | null;
      fieldPath: string;
      startedAt: string;
      state: schema.AnomalyState;
    }>
  > {
    const rows = await this.db
      .select({
        systemId: schema.anomalies.systemId,
        configurationId: schema.anomalies.configurationId,
        environmentId: schema.anomalies.environmentId,
        fieldPath: schema.anomalies.fieldPath,
        startedAt: schema.anomalies.startedAt,
        state: schema.anomalies.state,
      })
      .from(schema.anomalies)
      .where(
        and(
          inArray(schema.anomalies.state, ["anomaly", "suspicious"]),
          isNull(schema.anomalies.suppressedAt),
        ),
      )
      .orderBy(desc(schema.anomalies.startedAt));

    return rows.map((r) => ({
      ...r,
      startedAt: r.startedAt.toISOString(),
    }));
  }

  /**
   * Globally suppress a single anomaly row. Snapshots the current observed
   * value and baseline so the inline detector can auto-unsuppress once the
   * metric "changes again" (moves outside the relative reactivation band).
   *
   * The mutation is scoped by BOTH `anomalyId` and `systemId` — the access
   * gate authorizes the caller on `systemId`, so we must verify the target row
   * actually belongs to that system, otherwise a user with `feed.manage` on
   * system A could suppress system B's anomaly by passing B's id (IDOR).
   *
   * Only confirmed (`state === "anomaly"`) rows can be suppressed: the
   * auto-unsuppress re-evaluation lives in the confirmed-anomaly branch of the
   * detector, and a suppressed suspicious row would otherwise still confirm and
   * notify. Returns false if no matching confirmed row exists.
   */
  async suppressAnomaly({
    anomalyId,
    systemId,
  }: {
    anomalyId: string;
    systemId: string;
  }): Promise<boolean> {
    const [existing] = await this.db
      .select()
      .from(schema.anomalies)
      .where(
        and(
          eq(schema.anomalies.id, anomalyId),
          eq(schema.anomalies.systemId, systemId),
        ),
      )
      .limit(1);

    if (!existing || existing.state !== "anomaly") return false;

    const observedNumeric = Number(existing.observedValue);

    await this.db
      .update(schema.anomalies)
      .set({
        suppressedAt: new Date(),
        suppressedValue: Number.isFinite(observedNumeric)
          ? observedNumeric
          : null,
        suppressedBaseline: existing.baselineValue,
      })
      .where(
        and(
          eq(schema.anomalies.id, anomalyId),
          eq(schema.anomalies.systemId, systemId),
        ),
      );

    return true;
  }

  /**
   * Clear suppression on a single anomaly row. Scoped by both `anomalyId` and
   * `systemId` for the same IDOR reason as {@link suppressAnomaly}.
   */
  async unsuppressAnomaly({
    anomalyId,
    systemId,
  }: {
    anomalyId: string;
    systemId: string;
  }): Promise<boolean> {
    const [existing] = await this.db
      .select()
      .from(schema.anomalies)
      .where(
        and(
          eq(schema.anomalies.id, anomalyId),
          eq(schema.anomalies.systemId, systemId),
        ),
      )
      .limit(1);

    if (!existing) return false;

    await this.db
      .update(schema.anomalies)
      .set({
        suppressedAt: null,
        suppressedValue: null,
        suppressedBaseline: null,
      })
      .where(
        and(
          eq(schema.anomalies.id, anomalyId),
          eq(schema.anomalies.systemId, systemId),
        ),
      );

    return true;
  }

  async getAnomalyBaselines(params: {
    systemId: string;
    configurationId: string;
    /**
     * Optional environment filter. Mirrors the proc input tristate:
     * - `undefined` → no env predicate (return every env for this
     *   system+config, e.g. the single-env rollup drawer or non-scoped
     *   callers).
     * - `null` → only the env-less slice (environment_id IS NULL).
     * - a string → only that environment's baselines.
     */
    environmentId?: string | null;
  }) {
    const conditions = [
      eq(schema.anomalyBaselines.systemId, params.systemId),
      eq(schema.anomalyBaselines.configurationId, params.configurationId),
    ];

    if (params.environmentId !== undefined) {
      conditions.push(
        params.environmentId === null
          ? isNull(schema.anomalyBaselines.environmentId)
          : eq(schema.anomalyBaselines.environmentId, params.environmentId),
      );
    }

    const results = await this.db
      .select()
      .from(schema.anomalyBaselines)
      .where(and(...conditions));

    return results.map((r) => ({
      ...r,
      environmentId: r.environmentId,
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

    // Migrate-then-validate the stored record on read. `version: 1` with no
    // migrations today, so this is behavior-preserving now and stays correct
    // once a migration is added.
    return anomalySettingsConfig.parseRecord(toVersionedRecord(result.config));
  }

  /**
   * Batch counterpart to {@link getAnomalyConfig}: resolve template configs for
   * MANY configuration ids in ONE set-based `inArray` read instead of one
   * SELECT per id (an N+1 in the hourly baseline analyzer). Returns a map keyed
   * by configurationId; ids with no stored row resolve to the same default
   * wrapper `getAnomalyConfig` returns, so callers see identical values.
   *
   * `runner` lets the caller compose this read onto an existing
   * `withScopedTransaction` (defaults to the service db).
   */
  async getAnomalyConfigsByIds({
    configurationIds,
    runner = this.db,
  }: {
    configurationIds: string[];
    runner?: ScopedQueryRunner<typeof schema>;
  }): Promise<Map<string, VersionedRecord<AnomalySettings>>> {
    const uniqueIds = [...new Set(configurationIds)];
    const map = new Map<string, VersionedRecord<AnomalySettings>>();
    if (uniqueIds.length === 0) return map;

    const rows = await runner
      .select()
      .from(schema.anomalyConfigurations)
      .where(inArray(schema.anomalyConfigurations.configurationId, uniqueIds));
    const byId = new Map(rows.map((r) => [r.configurationId, r]));

    for (const id of uniqueIds) {
      const row = byId.get(id);
      map.set(
        id,
        row
          ? await anomalySettingsConfig.parseRecord(
              toVersionedRecord(row.config),
            )
          : anomalySettingsConfig.create({
              enabled: true,
              baselineWindow: "7d",
              notify: true,
            }),
      );
    }
    return map;
  }

  async updateAnomalyConfig(
    configurationId: string,
    configData: AnomalySettings,
  ) {
    const newConfigRecord = anomalySettingsConfig.create(configData);

    await this.db
      .insert(schema.anomalyConfigurations)
      .values({
        configurationId,
        config: newConfigRecord,
      })
      .onConflictDoUpdate({
        target: [schema.anomalyConfigurations.configurationId],
        set: { config: newConfigRecord },
      });

    // Return the validated record we just persisted (typed), rather than the
    // untyped jsonb round-trip.
    return newConfigRecord;
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

    if (!result) return;

    // Migrate-then-validate the stored override record on read (see
    // getAnomalyConfig). `version: 1` no-migrations today.
    return anomalyAssignmentConfig.parseRecord(
      toVersionedRecord(result.config),
    );
  }

  /**
   * Batch counterpart to {@link getAnomalyAssignmentConfig}: resolve
   * assignment-level overrides for MANY (systemId, configurationId) pairs in ONE
   * read instead of one SELECT per assignment (an N+1 in the hourly baseline
   * analyzer). Returns a map keyed by {@link anomalyAssignmentKey}; pairs with
   * no stored override are simply absent (mirroring the single method returning
   * `undefined`).
   *
   * `runner` lets the caller compose this read onto an existing
   * `withScopedTransaction` (defaults to the service db).
   */
  async getAnomalyAssignmentConfigsByKeys({
    keys,
    runner = this.db,
  }: {
    keys: Array<{ systemId: string; configurationId: string }>;
    runner?: ScopedQueryRunner<typeof schema>;
  }): Promise<Map<string, VersionedRecord<PartialAnomalySettings>>> {
    const map = new Map<string, VersionedRecord<PartialAnomalySettings>>();
    if (keys.length === 0) return map;

    // Dedupe pairs and build one OR-of-ANDs predicate so exactly the requested
    // assignments are returned (no cross-product over-fetch).
    const seen = new Set<string>();
    const conditions = [];
    for (const { systemId, configurationId } of keys) {
      const key = anomalyAssignmentKey(systemId, configurationId);
      if (seen.has(key)) continue;
      seen.add(key);
      conditions.push(
        and(
          eq(schema.anomalyAssignments.systemId, systemId),
          eq(schema.anomalyAssignments.configurationId, configurationId),
        ),
      );
    }

    const rows = await runner
      .select()
      .from(schema.anomalyAssignments)
      .where(or(...conditions));

    for (const row of rows) {
      map.set(
        anomalyAssignmentKey(row.systemId, row.configurationId),
        await anomalyAssignmentConfig.parseRecord(
          toVersionedRecord(row.config),
        ),
      );
    }
    return map;
  }

  async updateAnomalyAssignmentConfig(
    systemId: string,
    configurationId: string,
    configData: PartialAnomalySettings,
  ) {
    const newConfigRecord = anomalyAssignmentConfig.create(configData);

    await this.db
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
      });

    // Return the validated record we just persisted (typed).
    return newConfigRecord;
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
