/**
 * Flapping detection.
 *
 * This is the DETECTION half of the former auto-incident pipeline,
 * relocated here so it survives the removal of the hardcoded
 * incident-opening path (Phase 20). It records each transition-to-
 * unhealthy and, when the per-assignment policy's flapping threshold is
 * crossed within the window, emits the `healthcheck.flapping_detected`
 * automation hook.
 *
 * The emit is UNCONDITIONAL on a threshold cross - it no longer depends
 * on `autoOpenIncidentOnUnhealthy` (which gated it while incident-opening
 * was hardcoded). That matches the documented intent of the hook ("fires
 * regardless of the auto-incident flag") and is required for the
 * flapping default automation to react now that the hardcoded path is
 * gone.
 *
 * The actual incident-opening lives in user-editable automations
 * (`healthcheck.flapping_detected` -> `incident.create`), not here.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type { HealthCheckStatus } from "@checkstack/healthcheck-common";

import { healthCheckHooks } from "./hooks";
import { healthCheckUnhealthyTransitions } from "./schema";
import * as schema from "./schema";

type Db = SafeDatabase<typeof schema>;

type EmitHookFn = (
  hook: { id: string },
  payload: Record<string, unknown>,
) => Promise<void>;

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

export interface FlappingTriggerConfig {
  enabled: boolean;
  transitions: number;
  windowMinutes: number;
}

/**
 * On a transition-to-unhealthy, record it and - if the flapping trigger
 * is enabled and the count has crossed the threshold within the window -
 * emit `healthcheck.flapping_detected`. No-op when this run was not a
 * transition to unhealthy.
 *
 * Best-effort: DB / emit failures are logged and swallowed so flapping
 * detection never breaks the health-check flow.
 */
export async function detectAndEmitFlapping({
  db,
  configurationId,
  systemId,
  flappingTrigger,
  isTransition,
  getEmitHook,
  logger,
  now = new Date(),
}: {
  db: Db;
  configurationId: string;
  systemId: string;
  flappingTrigger: FlappingTriggerConfig;
  /** Whether the just-completed run was a transition to unhealthy. */
  isTransition: boolean;
  getEmitHook?: () => EmitHookFn | undefined;
  logger: Logger;
  now?: Date;
}): Promise<void> {
  if (!isTransition) return;

  let count: number;
  try {
    count = await recordUnhealthyTransition({
      db,
      configurationId,
      systemId,
      windowMinutes: flappingTrigger.windowMinutes,
      now,
    });
  } catch (error) {
    logger.warn(
      `Failed to record unhealthy transition for ${systemId}/${configurationId}:`,
      error,
    );
    return;
  }

  if (!flappingTrigger.enabled || count < flappingTrigger.transitions) {
    return;
  }

  const emit = getEmitHook?.();
  if (!emit) return;
  try {
    await emit(healthCheckHooks.flappingDetected, {
      systemId,
      configurationId,
      transitionCount: count,
      windowMinutes: flappingTrigger.windowMinutes,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    logger.warn(
      `Failed to emit healthcheck.flapping_detected hook for ${systemId}/${configurationId}:`,
      error,
    );
  }
}
