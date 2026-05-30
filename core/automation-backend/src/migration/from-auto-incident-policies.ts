/**
 * One-time, idempotent migration that replaces the removed hardcoded
 * auto-incident path (Phase 20) with user-editable default automations.
 *
 * For every (system, configuration) assignment, it seeds a default
 * automation whose thresholds mirror that assignment's
 * `NotificationPolicy` 1:1:
 *
 *   - `sustainedUnhealthyTrigger.durationMinutes` -> the `for:` dwell on a
 *     `healthcheck.system_degraded` trigger -> `incident.create`.
 *   - auto-close `autoCloseAfterMinutes` -> a `wait_until` that holds the
 *     run open until the system has been healthy continuously for the
 *     cooldown -> `incident.resolve` (consuming the created incident).
 *   - `useNotificationSuppression` -> `incident.create.suppressNotifications`.
 *   - `skipDuringMaintenance` -> a `{{ !health.system.in_maintenance }}`
 *     pre-run condition.
 *   - `flappingTrigger.{transitions,windowMinutes}` -> a second automation
 *     on the `healthcheck.flapping_detected` trigger -> `incident.create`.
 *
 * Per-system dedup is preserved via `concurrency_scope: "context_key"` +
 * `mode: "single"`: one in-flight run per system, so a system that keeps
 * re-degrading doesn't stack duplicate incidents. (Note: granularity is
 * per-(system, check), since policies are per-assignment - a system with
 * two independently-failing checks gets one auto-incident per check, each
 * closing independently. The old hardcoded path deduped per-system across
 * checks; this is the one documented behaviour change, surfaced in the
 * BREAKING changelog.)
 *
 * Idempotent: each automation is tagged `managed_by =
 * "auto-incident:<systemId>:<configurationId>:<kind>"` and re-runs skip
 * any that already exist. Anything that can't be mapped is recorded in
 * `automation_migration_failures` for admin review.
 */
import { eq } from "drizzle-orm";
import type {
  Logger,
  SafeDatabase,
  RpcClient,
} from "@checkstack/backend-api";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import {
  AutomationDefinitionSchema,
  type AutomationDefinition,
} from "@checkstack/automation-common";
import { extractErrorMessage } from "@checkstack/common";

import * as schema from "../schema";

type Db = SafeDatabase<typeof schema>;

interface AssignmentPolicy {
  systemId: string;
  configurationId: string;
  configurationName: string;
  policy: {
    autoOpenIncidentOnUnhealthy: boolean;
    useNotificationSuppression: boolean;
    skipDuringMaintenance: boolean;
    sustainedUnhealthyTrigger: { enabled: boolean; durationMinutes: number };
    flappingTrigger: {
      enabled: boolean;
      transitions: number;
      windowMinutes: number;
    };
    autoCloseAfterMinutes: number | null;
  };
}

interface MigrationResult {
  total: number;
  migrated: number;
  skipped: number;
  failed: number;
}

// Qualified ids (plugin-prefixed) of the triggers / actions used below.
const TRIGGER_SYSTEM_DEGRADED = "healthcheck.system_degraded";
const TRIGGER_SYSTEM_HEALTHY = "healthcheck.system_healthy";
const TRIGGER_FLAPPING = "healthcheck.flapping_detected";
const ACTION_INCIDENT_CREATE = "incident.create";
const ACTION_INCIDENT_RESOLVE = "incident.resolve";

/**
 * Build the sustained-unhealthy default automation for an assignment, or
 * `undefined` when the policy opts out (auto-open off, or the sustained
 * trigger disabled). The automation opens an incident after the system
 * has been degraded for `durationMinutes`, then waits until it has been
 * healthy for the cooldown before resolving.
 */
export function buildSustainedAutomation(
  a: AssignmentPolicy,
): AutomationDefinition | undefined {
  const p = a.policy;
  if (!p.autoOpenIncidentOnUnhealthy || !p.sustainedUnhealthyTrigger.enabled) {
    return undefined;
  }

  const conditions = p.skipDuringMaintenance
    ? ["!health.system.in_maintenance"]
    : [];

  const createConfig: Record<string, unknown> = {
    title: `{{ trigger.payload.systemName | default(trigger.payload.systemId) }} is unhealthy`,
    description: `Auto-opened: ${a.configurationName} has been unhealthy for ${p.sustainedUnhealthyTrigger.durationMinutes} min.`,
    severity: "critical",
    systemIds: ["{{ trigger.payload.systemId }}"],
    suppressNotifications: p.useNotificationSuppression,
    // At most one open auto-incident per system across all the default
    // sustained/flapping automations (reuses the old per-system dedup).
    dedupe_open_for_system: true,
  };

  const actions: unknown[] = [
    {
      id: "open_incident",
      action: ACTION_INCIDENT_CREATE,
      config: createConfig,
    },
  ];

  // Auto-close: wait until the system has been healthy continuously for
  // the cooldown, then resolve the incident we just opened. A null
  // cooldown means "never auto-close" - leave the incident for an
  // operator (no wait/resolve actions).
  if (p.autoCloseAfterMinutes !== null) {
    actions.push(
      {
        id: "await_recovery",
        wait_until: {
          condition: {
            and: [
              "health.system.status == 'healthy'",
              `health.system.in_status_since | older_than(${p.autoCloseAfterMinutes} | minutes)`,
            ],
          },
          // No timeout: hold until the system actually recovers, exactly
          // like the old close worker (which never gave up).
          continue_on_timeout: true,
          poll_seconds: 60,
        },
      },
      {
        id: "resolve_incident",
        action: ACTION_INCIDENT_RESOLVE,
        config: {
          message: `Auto-resolved: system stayed healthy for ${p.autoCloseAfterMinutes} minutes.`,
        },
      },
    );
  }

  return AutomationDefinitionSchema.parse({
    name: `Auto-incident: ${a.configurationName} sustained unhealthy`,
    description:
      "Default auto-incident automation (sustained unhealthy → open; healthy for cooldown → resolve). Seeded from the assignment's notification policy; edit freely.",
    triggers: [
      {
        event: TRIGGER_SYSTEM_DEGRADED,
        filter: `trigger.payload.systemId == "${a.systemId}"`,
        for: { minutes: p.sustainedUnhealthyTrigger.durationMinutes },
      },
    ],
    conditions,
    actions,
    mode: "single",
    concurrency_scope: "context_key",
    max_runs: 1,
  });
}

/**
 * Build the flapping default automation for an assignment, or
 * `undefined` when the policy opts out. Opens an incident when the
 * `flapping_detected` hook fires for this system.
 */
export function buildFlappingAutomation(
  a: AssignmentPolicy,
): AutomationDefinition | undefined {
  const p = a.policy;
  if (!p.autoOpenIncidentOnUnhealthy || !p.flappingTrigger.enabled) {
    return undefined;
  }

  const conditions = p.skipDuringMaintenance
    ? ["!health.system.in_maintenance"]
    : [];

  return AutomationDefinitionSchema.parse({
    name: `Auto-incident: ${a.configurationName} flapping`,
    description:
      "Default auto-incident automation (flapping → open). Seeded from the assignment's flapping policy; edit freely.",
    triggers: [
      {
        event: TRIGGER_FLAPPING,
        filter: `trigger.payload.systemId == "${a.systemId}" && trigger.payload.configurationId == "${a.configurationId}"`,
      },
    ],
    conditions,
    actions: [
      {
        id: "open_incident",
        action: ACTION_INCIDENT_CREATE,
        config: {
          title: `{{ trigger.payload.systemId }} is flapping`,
          description: `Auto-opened: ${a.configurationName} flapped ≥${p.flappingTrigger.transitions} times in ${p.flappingTrigger.windowMinutes} min.`,
          // critical for parity with the old path (always critical) — and
          // so a flapping incident never masks a co-occurring outage when
          // both dedupe to the same open system incident.
          severity: "critical",
          systemIds: ["{{ trigger.payload.systemId }}"],
          suppressNotifications: p.useNotificationSuppression,
          dedupe_open_for_system: true,
        },
      },
    ],
    mode: "single",
    concurrency_scope: "context_key",
    max_runs: 1,
  });
}

/** A planned default automation to seed. */
interface SeedPlan {
  managedBy: string;
  name: string;
  definition: AutomationDefinition;
}

/** All seed plans for one assignment (sustained + flapping, as enabled). */
export function planForAssignment(a: AssignmentPolicy): SeedPlan[] {
  const plans: SeedPlan[] = [];
  const sustained = buildSustainedAutomation(a);
  if (sustained) {
    plans.push({
      managedBy: `auto-incident:${a.systemId}:${a.configurationId}:sustained`,
      name: sustained.name,
      definition: sustained,
    });
  }
  const flapping = buildFlappingAutomation(a);
  if (flapping) {
    plans.push({
      managedBy: `auto-incident:${a.systemId}:${a.configurationId}:flapping`,
      name: flapping.name,
      definition: flapping,
    });
  }
  return plans;
}

/**
 * Run the auto-incident → default-automation migration. Idempotent: a
 * plan whose `managed_by` automation already exists is skipped. Pulls
 * the source policies via the healthcheck service RPC; if healthcheck is
 * unavailable (greenfield install), logs and skips rather than blocking
 * boot - mirrors `runWebhookSubscriptionMigration`.
 */
export async function runAutoIncidentMigration(args: {
  db: Db;
  rpcClient: RpcClient;
  logger: Logger;
}): Promise<MigrationResult> {
  const { db, rpcClient, logger } = args;

  let assignments: AssignmentPolicy[];
  try {
    const client = rpcClient.forPlugin(HealthCheckApi);
    assignments = await client.listAutoIncidentPolicies();
  } catch (error) {
    logger.warn(
      `auto-incident migration: could not read policies (healthcheck unavailable?); skipping: ${extractErrorMessage(error, "unknown error")}`,
    );
    return { total: 0, migrated: 0, skipped: 0, failed: 0 };
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const assignment of assignments) {
    let plans: SeedPlan[];
    try {
      plans = planForAssignment(assignment);
    } catch (error) {
      failed += 1;
      logger.error(
        `auto-incident migration: failed to build automations for ${assignment.systemId}/${assignment.configurationId}: ${extractErrorMessage(error, "build error")}`,
      );
      await recordFailure(db, assignment, extractErrorMessage(error, "build error"), logger);
      continue;
    }

    for (const plan of plans) {
      const existing = await db
        .select({ id: schema.automations.id })
        .from(schema.automations)
        .where(eq(schema.automations.managedBy, plan.managedBy))
        .limit(1);
      if (existing.length > 0) {
        skipped += 1;
        continue;
      }

      try {
        await db.insert(schema.automations).values({
          name: plan.name,
          description: plan.definition.description ?? null,
          status: "enabled",
          definition: plan.definition as unknown as Record<string, unknown>,
          managedBy: plan.managedBy,
        });
        migrated += 1;
        logger.info(`auto-incident migration: seeded "${plan.name}"`);
      } catch (error) {
        failed += 1;
        await recordFailure(
          db,
          assignment,
          extractErrorMessage(error, "insert failed"),
          logger,
        );
      }
    }
  }

  logger.info(
    `auto-incident migration: ${migrated} seeded, ${skipped} already present, ${failed} failed (across ${assignments.length} assignments)`,
  );
  return { total: assignments.length, migrated, skipped, failed };
}

async function recordFailure(
  db: Db,
  assignment: AssignmentPolicy,
  detail: string,
  logger: Logger,
): Promise<void> {
  try {
    await db
      .insert(schema.automationMigrationFailures)
      .values({
        subscriptionId: `auto-incident:${assignment.systemId}:${assignment.configurationId}`,
        subscriptionName: `Auto-incident for ${assignment.configurationName}`,
        providerId: "healthcheck.auto-incident",
        eventId: TRIGGER_SYSTEM_DEGRADED,
        reason: "auto-incident migration failed",
        detail,
        providerConfig: {
          systemId: assignment.systemId,
          configurationId: assignment.configurationId,
          policy: assignment.policy,
        },
      })
      .onConflictDoUpdate({
        target: schema.automationMigrationFailures.subscriptionId,
        set: { reason: "auto-incident migration failed", detail },
      });
  } catch (error) {
    logger.error(
      `auto-incident migration: could not record failure for ${assignment.systemId}/${assignment.configurationId}: ${extractErrorMessage(error, "unknown error")}`,
    );
  }
}

// Re-export TRIGGER_SYSTEM_HEALTHY usage marker (the healthy trigger is
// modelled inline via wait_until rather than a separate trigger, so the
// constant documents the relationship even though it isn't a trigger id
// the seeded automations subscribe to directly).
void TRIGGER_SYSTEM_HEALTHY;
