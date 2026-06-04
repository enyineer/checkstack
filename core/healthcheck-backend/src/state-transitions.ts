import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { HealthCheckStatus } from "@checkstack/healthcheck-common";
import type { SafeDatabase } from "@checkstack/backend-api";
import { healthCheckStateTransitions } from "./schema";
import * as schema from "./schema";

type Db = SafeDatabase<typeof schema>;

/**
 * Record an aggregate health-status transition for a system. Called at
 * the same point `systemHealthChanged` fires (one row per aggregate
 * transition, which is rare). `fromStatus` is null on the first-ever
 * recorded transition for a system.
 */
export async function recordStateTransition({
  db,
  systemId,
  configurationId,
  environmentId,
  fromStatus,
  toStatus,
  now = new Date(),
}: {
  db: Db;
  systemId: string;
  configurationId: string;
  /**
   * Environment this transition belongs to (per-environment fan-out).
   * null/undefined = env-less run. Kept distinct so "in status since" is
   * env-scoped.
   */
  environmentId?: string | null;
  fromStatus: HealthCheckStatus | undefined;
  toStatus: HealthCheckStatus;
  now?: Date;
}): Promise<void> {
  await db.insert(healthCheckStateTransitions).values({
    systemId,
    configurationId,
    environmentId: environmentId ?? null,
    fromStatus: fromStatus ?? null,
    toStatus,
    transitionedAt: now,
  });
}

/**
 * Find the timestamp at which the system most recently entered the
 * given status (the start of its current streak in that status).
 *
 * Fail-safe: when no transition row exists (e.g. the table was pruned
 * before this system ever transitioned, or it has never changed status)
 * this returns `null` rather than throwing, so callers degrade to
 * `inStatusSince: null` instead of failing the whole evaluation.
 */
export async function findInStatusSince({
  db,
  systemId,
  status,
  environmentId,
}: {
  db: Db;
  systemId: string;
  status: HealthCheckStatus;
  /**
   * Environment to scope the lookup to (Phase 3b). `undefined` = system-wide
   * (rollup; any environment + env-less). `null` = the env-less slice only. A
   * string = that environment's transitions only. The lookup index leads with
   * (system_id, environment_id, to_status, transitioned_at) so the env-scoped
   * query is index-efficient.
   */
  environmentId?: string | null;
}): Promise<Date | null> {
  const envFilter =
    environmentId === undefined
      ? undefined
      : environmentId === null
        ? isNull(healthCheckStateTransitions.environmentId)
        : eq(healthCheckStateTransitions.environmentId, environmentId);

  const [row] = await db
    .select({ transitionedAt: healthCheckStateTransitions.transitionedAt })
    .from(healthCheckStateTransitions)
    .where(
      and(
        eq(healthCheckStateTransitions.systemId, systemId),
        eq(healthCheckStateTransitions.toStatus, status),
        ...(envFilter ? [envFilter] : []),
      ),
    )
    .orderBy(desc(healthCheckStateTransitions.transitionedAt))
    .limit(1);

  return row?.transitionedAt ?? null;
}

/**
 * Count aggregate state transitions for a system within the trailing
 * window `[now - windowMinutes, now]`. Generalizes the flapping detector's
 * "N transitions in M minutes" count beyond the unhealthy-only table.
 *
 * When `toStatus` is given, counts only transitions INTO that status
 * (e.g. flapping = repeated transitions into `unhealthy`); omit it to
 * count all status changes in the window.
 *
 * Fail-safe: returns 0 on any error rather than throwing, so a count
 * read never wedges an evaluation.
 */
export async function countStateTransitionsInWindow({
  db,
  systemId,
  windowMinutes,
  toStatus,
  environmentId,
  now = new Date(),
}: {
  db: Db;
  systemId: string;
  windowMinutes: number;
  toStatus?: HealthCheckStatus;
  /**
   * Environment to scope the count to (Phase 3b). `undefined` = system-wide
   * (rollup). `null` = env-less slice only. A string = that environment only.
   */
  environmentId?: string | null;
  now?: Date;
}): Promise<number> {
  const windowStart = new Date(now.getTime() - windowMinutes * 60_000);
  const conditions = [
    eq(healthCheckStateTransitions.systemId, systemId),
    gte(healthCheckStateTransitions.transitionedAt, windowStart),
  ];
  if (toStatus) {
    conditions.push(eq(healthCheckStateTransitions.toStatus, toStatus));
  }
  if (environmentId !== undefined) {
    conditions.push(
      environmentId === null
        ? isNull(healthCheckStateTransitions.environmentId)
        : eq(healthCheckStateTransitions.environmentId, environmentId),
    );
  }

  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(healthCheckStateTransitions)
    .where(and(...conditions));

  return row?.count ?? 0;
}
