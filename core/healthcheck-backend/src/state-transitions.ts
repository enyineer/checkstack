import { and, desc, eq } from "drizzle-orm";
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
  fromStatus,
  toStatus,
  now = new Date(),
}: {
  db: Db;
  systemId: string;
  configurationId: string;
  fromStatus: HealthCheckStatus | undefined;
  toStatus: HealthCheckStatus;
  now?: Date;
}): Promise<void> {
  await db.insert(healthCheckStateTransitions).values({
    systemId,
    configurationId,
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
}: {
  db: Db;
  systemId: string;
  status: HealthCheckStatus;
}): Promise<Date | null> {
  const [row] = await db
    .select({ transitionedAt: healthCheckStateTransitions.transitionedAt })
    .from(healthCheckStateTransitions)
    .where(
      and(
        eq(healthCheckStateTransitions.systemId, systemId),
        eq(healthCheckStateTransitions.toStatus, status),
      ),
    )
    .orderBy(desc(healthCheckStateTransitions.transitionedAt))
    .limit(1);

  return row?.transitionedAt ?? null;
}
