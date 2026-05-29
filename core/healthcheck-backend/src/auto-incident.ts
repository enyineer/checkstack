import { and, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import type {
  HealthCheckStatus,
  NotificationPolicy,
} from "@checkstack/healthcheck-common";
import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type { InferClient } from "@checkstack/common";
import { IncidentApi } from "@checkstack/incident-common";
import { MaintenanceApi } from "@checkstack/maintenance-common";
import {
  healthCheckAutoIncidents,
  healthCheckRuns,
  healthCheckUnhealthyTransitions,
} from "./schema";
import * as schema from "./schema";

type Db = SafeDatabase<typeof schema>;
type IncidentClient = InferClient<typeof IncidentApi>;
type MaintenanceClient = InferClient<typeof MaintenanceApi>;

/**
 * Returns true when the per-check evaluated state went from anything
 * other than `unhealthy` to `unhealthy` between two evaluations.
 */
export function isTransitionToUnhealthy(
  previous: HealthCheckStatus | undefined,
  next: HealthCheckStatus,
): boolean {
  return next === "unhealthy" && previous !== "unhealthy";
}

/**
 * Record a transition-to-unhealthy in the audit table and return the
 * total transition count for this check inside the configured window
 * (the new row is included in the count). When `since` is provided,
 * only transitions strictly after that timestamp are counted — used
 * to ensure a freshly-opened auto-incident isn't re-triggered by
 * pre-close transitions after the prior incident was resolved.
 */
export async function recordUnhealthyTransition({
  db,
  configurationId,
  systemId,
  windowMinutes,
  since,
  now = new Date(),
}: {
  db: Db;
  configurationId: string;
  systemId: string;
  windowMinutes: number;
  since?: Date;
  now?: Date;
}): Promise<number> {
  await db.insert(healthCheckUnhealthyTransitions).values({
    configurationId,
    systemId,
    transitionedAt: now,
  });

  const windowStart = new Date(now.getTime() - windowMinutes * 60_000);
  const lowerBound =
    since && since > windowStart ? since : windowStart;

  const result = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(healthCheckUnhealthyTransitions)
    .where(
      and(
        eq(healthCheckUnhealthyTransitions.configurationId, configurationId),
        eq(healthCheckUnhealthyTransitions.systemId, systemId),
        gte(healthCheckUnhealthyTransitions.transitionedAt, lowerBound),
      ),
    );

  return result[0]?.count ?? 0;
}

/**
 * Decide whether the flapping trigger should open an auto-incident.
 * Returns false when the trigger is disabled or the count is below
 * the configured threshold.
 */
export function shouldOpenForFlapping({
  policy,
  recentTransitionCount,
}: {
  policy: NotificationPolicy;
  recentTransitionCount: number;
}): boolean {
  if (!policy.autoOpenIncidentOnUnhealthy) return false;
  if (!policy.flappingTrigger.enabled) return false;
  return recentTransitionCount >= policy.flappingTrigger.transitions;
}

/**
 * Decide whether the sustained-duration trigger should open an
 * auto-incident given the elapsed-unhealthy time for this check.
 */
export function shouldOpenForSustainedUnhealthy({
  policy,
  unhealthyForMs,
}: {
  policy: NotificationPolicy;
  /** How long the check has been continuously unhealthy. */
  unhealthyForMs: number;
}): boolean {
  if (!policy.autoOpenIncidentOnUnhealthy) return false;
  if (!policy.sustainedUnhealthyTrigger.enabled) return false;
  const thresholdMs =
    policy.sustainedUnhealthyTrigger.durationMinutes * 60_000;
  return unhealthyForMs >= thresholdMs;
}

/**
 * Find the most recent transition to `unhealthy` for this check that
 * happened after `since` (if provided). Used by the sustained-trigger
 * evaluator to compute "how long has the check been unhealthy?"
 */
export async function findUnhealthySince({
  db,
  configurationId,
  systemId,
  since,
}: {
  db: Db;
  configurationId: string;
  systemId: string;
  since?: Date;
}): Promise<Date | undefined> {
  const conditions = [
    eq(healthCheckUnhealthyTransitions.configurationId, configurationId),
    eq(healthCheckUnhealthyTransitions.systemId, systemId),
  ];
  if (since) {
    conditions.push(gte(healthCheckUnhealthyTransitions.transitionedAt, since));
  }

  const [row] = await db
    .select({
      transitionedAt: healthCheckUnhealthyTransitions.transitionedAt,
    })
    .from(healthCheckUnhealthyTransitions)
    .where(and(...conditions))
    .orderBy(desc(healthCheckUnhealthyTransitions.transitionedAt))
    .limit(1);

  return row?.transitionedAt;
}

/**
 * Find any currently-active (closedAt IS NULL) auto-incident for the
 * system. Used to avoid opening a duplicate when one is already open.
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
 * Most recent close time for an auto-incident on this assignment, or
 * undefined if none has ever closed. Used to gate re-opens behind a
 * "must recover first" rule.
 */
export async function findLastAutoIncidentClose({
  db,
  systemId,
  configurationId,
}: {
  db: Db;
  systemId: string;
  configurationId: string;
}): Promise<Date | undefined> {
  const [row] = await db
    .select({ closedAt: healthCheckAutoIncidents.closedAt })
    .from(healthCheckAutoIncidents)
    .where(
      and(
        eq(healthCheckAutoIncidents.systemId, systemId),
        eq(healthCheckAutoIncidents.configurationId, configurationId),
        isNotNull(healthCheckAutoIncidents.closedAt),
      ),
    )
    .orderBy(desc(healthCheckAutoIncidents.closedAt))
    .limit(1);

  return row?.closedAt ?? undefined;
}

/**
 * Has this check produced at least one healthy run since the given
 * timestamp? Used to confirm the system has actually recovered between
 * the last auto-incident close and now before a new auto-incident is
 * allowed to open.
 */
export async function hasHealthyRunSince({
  db,
  systemId,
  configurationId,
  since,
}: {
  db: Db;
  systemId: string;
  configurationId: string;
  since: Date;
}): Promise<boolean> {
  const [row] = await db
    .select({ id: healthCheckRuns.id })
    .from(healthCheckRuns)
    .where(
      and(
        eq(healthCheckRuns.systemId, systemId),
        eq(healthCheckRuns.configurationId, configurationId),
        eq(healthCheckRuns.status, "healthy"),
        gte(healthCheckRuns.timestamp, since),
      ),
    )
    .limit(1);

  return !!row;
}

/**
 * Check whether the system currently has an active maintenance window
 * with suppression. Falls back to "not suppressed" on errors so a
 * downstream outage doesn't accidentally block legitimate incidents.
 */
export async function isMaintenanceSuppressed({
  maintenanceClient,
  systemId,
  logger,
}: {
  maintenanceClient: MaintenanceClient;
  systemId: string;
  logger: Logger;
}): Promise<boolean> {
  try {
    const { suppressed } =
      await maintenanceClient.hasActiveMaintenanceWithSuppression({ systemId });
    return suppressed;
  } catch (error) {
    logger.warn(
      `Failed to check maintenance for ${systemId} during auto-incident decision; assuming not suppressed:`,
      error,
    );
    return false;
  }
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
  reason,
}: {
  db: Db;
  incidentClient: IncidentClient;
  logger: Logger;
  systemId: string;
  systemName: string;
  configurationId: string;
  configurationName: string;
  policy: NotificationPolicy;
  /** Short human-readable phrase for the incident description. */
  reason: string;
}): Promise<{ incidentId: string } | undefined> {
  const existing = await findActiveAutoIncident({ db, systemId });
  if (existing) {
    return { incidentId: existing.incidentId };
  }

  try {
    const { id: incidentId } = await incidentClient.createAutoIncident({
      title: `${systemName} is critical`,
      description: `Auto-opened by health check **${configurationName}** (${reason}).`,
      severity: "critical",
      suppressNotifications: policy.useNotificationSuppression,
      systemIds: [systemId],
      initialMessage: `Health check \`${configurationName}\` triggered the auto-incident: ${reason}.`,
    });

    await db.insert(healthCheckAutoIncidents).values({
      incidentId,
      systemId,
      configurationId,
      cooldownMinutes: policy.autoCloseAfterMinutes,
    });

    logger.info(
      `Auto-opened incident ${incidentId} for system ${systemId} (check ${configurationId}; ${reason})`,
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
