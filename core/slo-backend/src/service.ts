import { eq, and, isNull, desc, gte, lte, or } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import { withScopedTransaction } from "@checkstack/backend-api";
import * as schema from "./schema";
import {
  aggregateWindowedDowntime,
  type MaintenanceWindowInput,
} from "./downtime-window";
import {
  sloObjectives,
  sloDowntimeEvents,
  sloDailySnapshots,
  sloStreaks,
  sloAchievements,
} from "./schema";
import type {
  CreateSloObjectiveInput,
  UpdateSloObjectiveInput,
  SloObjective,
  SloDowntimeEvent,
  SloDailySnapshot,
  SloStreak,
  SloAchievement,
  AttributionType,
  DowntimeSource,
} from "@checkstack/slo-common";

type Db = SafeDatabase<typeof schema>;

function generateId(): string {
  return crypto.randomUUID();
}

export class SloService {
  constructor(private db: Db) {}

  // ===========================================================================
  // OBJECTIVES CRUD
  // ===========================================================================

  async listObjectives(): Promise<SloObjective[]> {
    const rows = await this.db.select().from(sloObjectives);
    return rows.map((row) => mapObjectiveRow(row));
  }

  async getObjective({
    id,
  }: {
    id: string;
  }): Promise<SloObjective | undefined> {
    const [row] = await this.db
      .select()
      .from(sloObjectives)
      .where(eq(sloObjectives.id, id));
    return row ? mapObjectiveRow(row) : undefined;
  }

  async getObjectivesForSystem({
    systemId,
  }: {
    systemId: string;
  }): Promise<SloObjective[]> {
    const rows = await this.db
      .select()
      .from(sloObjectives)
      .where(eq(sloObjectives.systemId, systemId));
    return rows.map((row) => mapObjectiveRow(row));
  }

  async createObjective({
    input,
  }: {
    input: CreateSloObjectiveInput;
  }): Promise<SloObjective> {
    const id = generateId();
    const now = new Date();

    // Atomic: the objective row and its 1:1 streak row must commit together.
    // Without the transaction a failure on the streak insert left a committed
    // objective with no streak (and the client saw an error for a write that
    // partially succeeded).
    await this.db.transaction(async (tx) => {
      await tx.insert(sloObjectives).values({
        id,
        systemId: input.systemId,

        healthCheckConfigurationId: input.healthCheckConfigurationId ?? null,
        target: input.target,
        windowDays: input.windowDays,
        dependencyExclusion: input.dependencyExclusion ?? "strict",
        excludedDependencyIds: input.excludedDependencyIds ?? [],
        excludeMaintenanceWindows: input.excludeMaintenanceWindows ?? false,
        burnRateWarningPercent: input.burnRateThresholds?.warningPercent ?? 50,
        burnRateCriticalPercent: input.burnRateThresholds?.criticalPercent ?? 80,
        burnRateFastBurnMultiplier:
          input.burnRateThresholds?.fastBurnMultiplier ?? 5,
        createdAt: now,
        updatedAt: now,
      });

      // Create initial streak record
      await tx.insert(sloStreaks).values({
        objectiveId: id,
        systemId: input.systemId,
        currentStreak: 0,
        bestStreak: 0,
      });
    });

    return (await this.getObjective({ id }))!;
  }

  async updateObjective({
    input,
  }: {
    input: UpdateSloObjectiveInput;
  }): Promise<SloObjective | undefined> {
    // Batched: the existence check, the update, and the reload of the fresh
    // row run under one SET LOCAL search_path. `.returning()` folds the reload
    // into the UPDATE, so this is a single transaction (one SELECT + one
    // UPDATE ... RETURNING) instead of three standalone scoped queries.
    return withScopedTransaction(this.db, async (tx) => {
      const [existing] = await tx
        .select()
        .from(sloObjectives)
        .where(eq(sloObjectives.id, input.id));

      if (!existing) return;

      const updateData: Partial<typeof sloObjectives.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.target !== undefined) updateData.target = input.target;
      if (input.windowDays !== undefined)
        updateData.windowDays = input.windowDays;
      if (input.dependencyExclusion !== undefined)
        updateData.dependencyExclusion = input.dependencyExclusion;
      if (input.excludedDependencyIds !== undefined)
        updateData.excludedDependencyIds = input.excludedDependencyIds;
      if (input.excludeMaintenanceWindows !== undefined)
        updateData.excludeMaintenanceWindows = input.excludeMaintenanceWindows;
      if (input.burnRateThresholds !== undefined) {
        updateData.burnRateWarningPercent =
          input.burnRateThresholds.warningPercent;
        updateData.burnRateCriticalPercent =
          input.burnRateThresholds.criticalPercent;
        updateData.burnRateFastBurnMultiplier =
          input.burnRateThresholds.fastBurnMultiplier;
      }

      const [updated] = await tx
        .update(sloObjectives)
        .set(updateData)
        .where(eq(sloObjectives.id, input.id))
        .returning();

      return mapObjectiveRow(updated);
    });
  }

  async deleteObjective({ id }: { id: string }): Promise<boolean> {
    const [existing] = await this.db
      .select()
      .from(sloObjectives)
      .where(eq(sloObjectives.id, id));

    if (!existing) return false;

    // Cascade delete handles downtime events, snapshots, streaks
    await this.db.delete(sloObjectives).where(eq(sloObjectives.id, id));
    return true;
  }

  async deleteObjectivesForSystem({
    systemId,
  }: {
    systemId: string;
  }): Promise<void> {
    await this.db
      .delete(sloObjectives)
      .where(eq(sloObjectives.systemId, systemId));
  }

  // ===========================================================================
  // DOWNTIME EVENTS
  // ===========================================================================

  async openDowntimeEvent({
    objectiveId,
    systemId,
    attributionType,
    upstreamSystemId,
    upstreamSystemName,
    source,
  }: {
    objectiveId: string;
    systemId: string;
    attributionType: AttributionType;
    upstreamSystemId?: string;
    upstreamSystemName?: string;
    /**
     * Cause of the downtime. Defaults to "healthcheck" (the legacy/probe cause)
     * so existing callers are unchanged; the incident channel passes "incident".
     */
    source?: DowntimeSource;
  }): Promise<SloDowntimeEvent> {
    const id = generateId();
    const now = new Date();

    // `.returning()` yields the inserted row directly, so the former
    // insert-then-reload pair collapses to a single INSERT ... RETURNING.
    const [event] = await this.db
      .insert(sloDowntimeEvents)
      .values({
        id,
        objectiveId,
        systemId,
        startTime: now,
        attributionType,

        upstreamSystemId: upstreamSystemId ?? null,

        upstreamSystemName: upstreamSystemName ?? null,

        source: source ?? "healthcheck",
      })
      .returning();

    return mapDowntimeEventRow(event);
  }

  async closeDowntimeEvent({
    id,
    endTime,
  }: {
    id: string;
    /**
     * Explicit close timestamp. Defaults to now (the normal recovery-edge
     * close). Pass the ACTUAL recovery time when reconciling a missed-recovery
     * orphan, so the genuine downtime is preserved instead of lost. Clamped to
     * be >= the event's `startTime` so a bad input can never write negative
     * duration.
     */
    endTime?: Date;
  }): Promise<SloDowntimeEvent> {
    // Batched: the load, the update, and the reload of the closed row run
    // under one SET LOCAL search_path. `.returning()` folds the reload into
    // the UPDATE, so this is one transaction (a SELECT + an UPDATE ...
    // RETURNING) instead of three standalone scoped queries.
    return withScopedTransaction(this.db, async (tx) => {
      const [event] = await tx
        .select()
        .from(sloDowntimeEvents)
        .where(eq(sloDowntimeEvents.id, id));

      if (!event || event.endTime) {
        throw new Error(
          `Cannot close downtime event ${id}: not found or already closed`,
        );
      }

      const requestedEnd = endTime ?? new Date();
      const end =
        requestedEnd.getTime() < event.startTime.getTime()
          ? event.startTime
          : requestedEnd;
      const durationSeconds =
        (end.getTime() - event.startTime.getTime()) / 1000;

      const [updated] = await tx
        .update(sloDowntimeEvents)
        .set({ endTime: end, durationSeconds })
        .where(eq(sloDowntimeEvents.id, id))
        .returning();

      return mapDowntimeEventRow(updated);
    });
  }

  async getOpenDowntimeEvents({
    systemId,
  }: {
    systemId: string;
  }): Promise<SloDowntimeEvent[]> {
    const rows = await this.db
      .select()
      .from(sloDowntimeEvents)
      .where(
        and(
          eq(sloDowntimeEvents.systemId, systemId),
          isNull(sloDowntimeEvents.endTime),
        ),
      );
    return rows.map((row) => mapDowntimeEventRow(row));
  }

  async getOpenDowntimeEventsForObjective({
    objectiveId,
  }: {
    objectiveId: string;
  }): Promise<SloDowntimeEvent[]> {
    const rows = await this.db
      .select()
      .from(sloDowntimeEvents)
      .where(
        and(
          eq(sloDowntimeEvents.objectiveId, objectiveId),
          isNull(sloDowntimeEvents.endTime),
        ),
      );
    return rows.map((row) => mapDowntimeEventRow(row));
  }

  async getOpenUpstreamEvents({
    systemId,
    upstreamSystemId,
  }: {
    systemId: string;
    upstreamSystemId: string;
  }): Promise<SloDowntimeEvent[]> {
    const rows = await this.db
      .select()
      .from(sloDowntimeEvents)
      .where(
        and(
          eq(sloDowntimeEvents.systemId, systemId),
          eq(sloDowntimeEvents.attributionType, "upstream"),
          eq(sloDowntimeEvents.upstreamSystemId, upstreamSystemId),
          isNull(sloDowntimeEvents.endTime),
        ),
      );
    return rows.map((row) => mapDowntimeEventRow(row));
  }

  async getOpenSelfEvents({
    systemId,
  }: {
    systemId: string;
  }): Promise<SloDowntimeEvent[]> {
    const rows = await this.db
      .select()
      .from(sloDowntimeEvents)
      .where(
        and(
          eq(sloDowntimeEvents.systemId, systemId),
          eq(sloDowntimeEvents.attributionType, "self"),
          isNull(sloDowntimeEvents.endTime),
        ),
      );
    return rows.map((row) => mapDowntimeEventRow(row));
  }

  /**
   * Get budget consumption for an objective within a time window.
   * Returns total consumed minutes and per-attribution-type breakdown.
   */
  async getDowntimeForWindow({
    objectiveId,
    windowStart,
    windowEnd,
    includeOpen,
    maintenanceWindows,
  }: {
    objectiveId: string;
    windowStart: Date;
    windowEnd: Date;
    /**
     * Whether to count still-open events as ongoing downtime (clamped to `now`).
     * The caller decides this from the system's LIVE health: an open event is
     * only real ongoing downtime if the system is currently down. When false,
     * only closed intervals are counted, so a stale/orphaned open event (a
     * missed-recovery row) has zero effect on the budget.
     */
    includeOpen: boolean;
    /**
     * Optional planned maintenance windows to subtract from consumed downtime
     * (set when the objective opts into `excludeMaintenanceWindows`). Undefined
     * leaves downtime accounting unchanged.
     */
    maintenanceWindows?: MaintenanceWindowInput[];
  }): Promise<{
    totalMinutes: number;
    selfMinutes: number;
    upstreamMinutes: number;
    entries: Array<{
      attributionType: string;
      upstreamSystemId: string | null;
      upstreamSystemName: string | null;
      totalMinutes: number;
    }>;
  }> {
    // Closed intervals that OVERLAP the window: started on/before the window end
    // AND ended on/after the window start. (`endTime >= windowStart` excludes
    // NULL end times, i.e. open events, in SQL.) An ongoing outage that began
    // before `windowStart` still consumes its in-window portion - it is not
    // dropped just because it started earlier.
    const now = new Date();
    const startBound = lte(sloDowntimeEvents.startTime, windowEnd);
    const closedOverlap = gte(sloDowntimeEvents.endTime, windowStart);
    const where = includeOpen
      ? and(
          eq(sloDowntimeEvents.objectiveId, objectiveId),
          startBound,
          or(closedOverlap, isNull(sloDowntimeEvents.endTime)),
        )
      : and(
          eq(sloDowntimeEvents.objectiveId, objectiveId),
          startBound,
          closedOverlap,
        );

    const events = await this.db.select().from(sloDowntimeEvents).where(where);

    // Clamp each event to the window (open events run to `now`) and aggregate.
    return aggregateWindowedDowntime({
      events: events.map((event) => ({
        startTime: event.startTime,
        endTime: event.endTime,
        attributionType: event.attributionType,
        upstreamSystemId: event.upstreamSystemId,
        upstreamSystemName: event.upstreamSystemName,
      })),
      windowStart,
      windowEnd,
      now,
      maintenanceWindows,
    });
  }

  /**
   * Hard-delete a downtime event. Used to VOID a missed-recovery orphan: an
   * open event on a system that is currently healthy, whose true recovery time
   * was never recorded. We do not know the real downtime, the system is healthy,
   * so the unprovable row is removed rather than counted.
   */
  async deleteDowntimeEvent({ id }: { id: string }): Promise<void> {
    await this.db
      .delete(sloDowntimeEvents)
      .where(eq(sloDowntimeEvents.id, id));
  }

  async getRecentDowntimeEvents({
    objectiveId,
    limit,
  }: {
    objectiveId: string;
    limit: number;
  }): Promise<SloDowntimeEvent[]> {
    const rows = await this.db
      .select()
      .from(sloDowntimeEvents)
      .where(eq(sloDowntimeEvents.objectiveId, objectiveId))
      .orderBy(desc(sloDowntimeEvents.startTime))
      .limit(limit);
    return rows.map((row) => mapDowntimeEventRow(row));
  }

  // ===========================================================================
  // DAILY SNAPSHOTS
  // ===========================================================================

  async insertDailySnapshot({
    snapshot,
  }: {
    snapshot: Omit<SloDailySnapshot, "id">;
  }): Promise<void> {
    await this.db.insert(sloDailySnapshots).values({
      id: generateId(),
      ...snapshot,
    });
  }

  async getDailySnapshots({
    objectiveId,
    startDate,
    endDate,
  }: {
    objectiveId: string;
    startDate: Date;
    endDate: Date;
  }): Promise<SloDailySnapshot[]> {
    const rows = await this.db
      .select()
      .from(sloDailySnapshots)
      .where(
        and(
          eq(sloDailySnapshots.objectiveId, objectiveId),
          gte(sloDailySnapshots.date, startDate),
          lte(sloDailySnapshots.date, endDate),
        ),
      );
    return rows.map((row) => mapSnapshotRow(row));
  }

  // ===========================================================================
  // STREAKS
  // ===========================================================================

  async getStreak({
    objectiveId,
  }: {
    objectiveId: string;
  }): Promise<SloStreak | undefined> {
    const [row] = await this.db
      .select()
      .from(sloStreaks)
      .where(eq(sloStreaks.objectiveId, objectiveId));
    return row ? mapStreakRow(row) : undefined;
  }

  async getAllStreaks(): Promise<SloStreak[]> {
    const rows = await this.db.select().from(sloStreaks);
    return rows.map((row) => mapStreakRow(row));
  }

  async incrementStreak({
    objectiveId,
  }: {
    objectiveId: string;
  }): Promise<SloStreak> {
    const streak = await this.getStreak({ objectiveId });
    if (!streak) throw new Error(`Streak not found for objective ${objectiveId}`);

    const newCurrent = streak.currentStreak + 1;
    const newBest = Math.max(newCurrent, streak.bestStreak);
    const now = new Date();

    await this.db
      .update(sloStreaks)
      .set({
        currentStreak: newCurrent,
        bestStreak: newBest,
        streakStart: streak.streakStart ?? now,
         
        bestStreakEnd: newCurrent > streak.bestStreak ? null : streak.bestStreakEnd,
      })
      .where(eq(sloStreaks.objectiveId, objectiveId));

    return (await this.getStreak({ objectiveId }))!;
  }

  async resetStreak({
    objectiveId,
  }: {
    objectiveId: string;
  }): Promise<SloStreak> {
    const streak = await this.getStreak({ objectiveId });
    if (!streak) throw new Error(`Streak not found for objective ${objectiveId}`);

    const now = new Date();
    const updateData: Partial<typeof sloStreaks.$inferInsert> = {
      currentStreak: 0,
       
      streakStart: null,
    };

    // If current streak was the best, record when it ended
    if (streak.currentStreak >= streak.bestStreak && streak.currentStreak > 0) {
      updateData.bestStreakEnd = now;
    }

    await this.db
      .update(sloStreaks)
      .set(updateData)
      .where(eq(sloStreaks.objectiveId, objectiveId));

    return (await this.getStreak({ objectiveId }))!;
  }

  // ===========================================================================
  // ACHIEVEMENTS
  // ===========================================================================

  async getAchievements({
    systemId,
  }: {
    systemId: string;
  }): Promise<SloAchievement[]> {
    const rows = await this.db
      .select()
      .from(sloAchievements)
      .where(eq(sloAchievements.systemId, systemId));
    return rows.map((row) => mapAchievementRow(row));
  }

  async getRecentMilestones({
    limit,
  }: {
    limit: number;
  }): Promise<SloAchievement[]> {
    const rows = await this.db
      .select()
      .from(sloAchievements)
      .orderBy(desc(sloAchievements.unlockedAt))
      .limit(limit);
    return rows.map((row) => mapAchievementRow(row));
  }

  async hasAchievement({
    systemId,
    achievement,
  }: {
    systemId: string;
    achievement: string;
  }): Promise<boolean> {
    const [existing] = await this.db
      .select({ id: sloAchievements.id })
      .from(sloAchievements)
      .where(
        and(
          eq(sloAchievements.systemId, systemId),
          eq(sloAchievements.achievement, achievement),
        ),
      )
      .limit(1);
    return !!existing;
  }

  async unlockAchievement({
    systemId,
    achievement,
  }: {
    systemId: string;
    achievement: string;
  }): Promise<SloAchievement | undefined> {
    // Idempotent: skip if already unlocked
    if (await this.hasAchievement({ systemId, achievement })) {
      return undefined;
    }

    const id = generateId();
    await this.db.insert(sloAchievements).values({
      id,
      systemId,
      achievement,
      unlockedAt: new Date(),
    });

    const [row] = await this.db
      .select()
      .from(sloAchievements)
      .where(eq(sloAchievements.id, id));
    return mapAchievementRow(row);
  }

  async deleteAchievementsForSystem({
    systemId,
  }: {
    systemId: string;
  }): Promise<void> {
    await this.db
      .delete(sloAchievements)
      .where(eq(sloAchievements.systemId, systemId));
  }
}

// =============================================================================
// ROW MAPPERS
// =============================================================================

function mapObjectiveRow(
  row: typeof sloObjectives.$inferSelect,
): SloObjective {
  return {
    id: row.id,
    systemId: row.systemId,
    healthCheckConfigurationId: row.healthCheckConfigurationId,
    target: row.target,
    windowDays: row.windowDays,
    dependencyExclusion: row.dependencyExclusion as SloObjective["dependencyExclusion"],
    excludedDependencyIds: (row.excludedDependencyIds as string[] | null) ?? undefined,
    excludeMaintenanceWindows: row.excludeMaintenanceWindows,
    burnRateThresholds: {
      warningPercent: row.burnRateWarningPercent,
      criticalPercent: row.burnRateCriticalPercent,
      fastBurnMultiplier: row.burnRateFastBurnMultiplier,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapDowntimeEventRow(
  row: typeof sloDowntimeEvents.$inferSelect,
): SloDowntimeEvent {
  return {
    id: row.id,
    objectiveId: row.objectiveId,
    systemId: row.systemId,
    startTime: row.startTime,
    endTime: row.endTime,
    durationSeconds: row.durationSeconds,
    attributionType: row.attributionType as SloDowntimeEvent["attributionType"],
    upstreamSystemId: row.upstreamSystemId,
    upstreamSystemName: row.upstreamSystemName,
    // NULL rows (persisted before the column existed) are read as "healthcheck".
    source: (row.source as SloDowntimeEvent["source"]) ?? "healthcheck",
  };
}

function mapSnapshotRow(
  row: typeof sloDailySnapshots.$inferSelect,
): SloDailySnapshot {
  return {
    id: row.id,
    objectiveId: row.objectiveId,
    date: row.date,
    availabilityPercent: row.availabilityPercent,
    budgetConsumedMinutes: row.budgetConsumedMinutes,
    budgetRemainingPercent: row.budgetRemainingPercent,
    burnRate: row.burnRate,
    streakDays: row.streakDays,
  };
}

function mapStreakRow(row: typeof sloStreaks.$inferSelect): SloStreak {
  return {
    objectiveId: row.objectiveId,
    systemId: row.systemId,
    currentStreak: row.currentStreak,
    bestStreak: row.bestStreak,
    streakStart: row.streakStart,
    bestStreakEnd: row.bestStreakEnd,
  };
}

function mapAchievementRow(
  row: typeof sloAchievements.$inferSelect,
): SloAchievement {
  return {
    id: row.id,
    systemId: row.systemId,
    achievement: row.achievement as SloAchievement["achievement"],
    unlockedAt: row.unlockedAt,
  };
}
