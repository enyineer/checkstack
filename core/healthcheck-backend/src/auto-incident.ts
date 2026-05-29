import { and, eq, gte, isNull, sql } from "drizzle-orm";
import type {
  HealthCheckStatus,
  NotificationPolicy,
} from "@checkstack/healthcheck-common";
import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type { InferClient } from "@checkstack/common";
import { IncidentApi } from "@checkstack/incident-common";
import {
  healthCheckAutoIncidents,
  healthCheckUnhealthyTransitions,
} from "./schema";
import * as schema from "./schema";

type Db = SafeDatabase<typeof schema>;
type IncidentClient = InferClient<typeof IncidentApi>;

/**
 * Returns true when the per-check evaluated state went from anything
 * other than `unhealthy` to `unhealthy` between two evaluations.
 * Recoveries, escalations from healthy to degraded, and stays-in-place
 * all return false.
 */
export function isTransitionToUnhealthy(
  previous: HealthCheckStatus | undefined,
  next: HealthCheckStatus,
): boolean {
  return next === "unhealthy" && previous !== "unhealthy";
}

/**
 * Decide whether an auto-incident should be opened for this check
 * based on its policy and how many transitions to unhealthy it has
 * accumulated in the configured window (including the one that just
 * happened).
 */
export function shouldOpenAutoIncident({
  policy,
  recentTransitionCount,
}: {
  policy: NotificationPolicy;
  /** Count of transitions in window, including the just-recorded one. */
  recentTransitionCount: number;
}): boolean {
  if (!policy.autoOpenIncidentOnUnhealthy) return false;
  return recentTransitionCount >= policy.incidentThreshold.transitions;
}

/**
 * Record a transition-to-unhealthy in the audit table and return the
 * total transition count for this check inside the configured window
 * (the new row is included in the count).
 */
export async function recordUnhealthyTransition({
  db,
  configurationId,
  systemId,
  windowMinutes,
  now = new Date(),
}: {
  db: Db;
  configurationId: string;
  systemId: string;
  windowMinutes: number;
  now?: Date;
}): Promise<number> {
  await db.insert(healthCheckUnhealthyTransitions).values({
    configurationId,
    systemId,
    transitionedAt: now,
  });

  const windowStart = new Date(now.getTime() - windowMinutes * 60_000);
  const result = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(healthCheckUnhealthyTransitions)
    .where(
      and(
        eq(healthCheckUnhealthyTransitions.configurationId, configurationId),
        eq(healthCheckUnhealthyTransitions.systemId, systemId),
        gte(healthCheckUnhealthyTransitions.transitionedAt, windowStart),
      ),
    );

  return result[0]?.count ?? 0;
}

/**
 * Find an active (not yet closed) auto-incident for the given system.
 * Used to avoid opening a second auto-incident on top of an existing
 * one — we attach to the existing incident instead of creating a new
 * row.
 */
export async function findActiveAutoIncident({
  db,
  systemId,
}: {
  db: Db;
  systemId: string;
}): Promise<{ id: string; incidentId: string } | undefined> {
  const rows = await db
    .select({
      id: healthCheckAutoIncidents.id,
      incidentId: healthCheckAutoIncidents.incidentId,
    })
    .from(healthCheckAutoIncidents)
    .where(
      and(
        eq(healthCheckAutoIncidents.systemId, systemId),
        isNull(healthCheckAutoIncidents.closedAt),
      ),
    )
    .limit(1);

  return rows[0];
}

/**
 * Open an auto-incident through the incident plugin's service-level
 * RPC and persist the mapping so the auto-close worker can find and
 * resolve it later. No-op (returns existing mapping) when an active
 * auto-incident already exists for the system.
 */
export async function openAutoIncident({
  db,
  incidentClient,
  logger,
  systemId,
  systemName,
  configurationId,
  configurationName,
  policy,
  triggeringTransitionCount,
}: {
  db: Db;
  incidentClient: IncidentClient;
  logger: Logger;
  systemId: string;
  systemName: string;
  configurationId: string;
  configurationName: string;
  policy: NotificationPolicy;
  triggeringTransitionCount: number;
}): Promise<{ incidentId: string } | undefined> {
  const existing = await findActiveAutoIncident({ db, systemId });
  if (existing) {
    return { incidentId: existing.incidentId };
  }

  const flapNote =
    triggeringTransitionCount > 1
      ? ` after ${triggeringTransitionCount} transitions in the last ${policy.incidentThreshold.windowMinutes} minutes`
      : "";

  try {
    const { id: incidentId } = await incidentClient.createAutoIncident({
      title: `${systemName} is critical`,
      description: `Auto-opened by health check **${configurationName}**${flapNote}.`,
      severity: "critical",
      suppressNotifications: policy.useNotificationSuppression,
      systemIds: [systemId],
      initialMessage: `Health check \`${configurationName}\` transitioned to unhealthy.`,
    });

    await db.insert(healthCheckAutoIncidents).values({
      incidentId,
      systemId,
      configurationId,
    });

    logger.info(
      `Auto-opened incident ${incidentId} for system ${systemId} (check ${configurationId})`,
    );
    return { incidentId };
  } catch (error) {
    // Auto-incident creation is best-effort — failure here shouldn't
    // block the rest of the health-check flow.
    logger.warn(
      `Failed to open auto-incident for system ${systemId} (check ${configurationId}):`,
      error,
    );
    return undefined;
  }
}
