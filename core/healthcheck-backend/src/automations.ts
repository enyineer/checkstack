/**
 * Healthcheck triggers + actions registered with the Automation Platform.
 *
 * Triggers:
 *   - `healthcheck.system.degraded` — existing directional hook
 *   - `healthcheck.system.healthy` — existing directional hook
 *   - `healthcheck.system.health_changed` — new umbrella hook,
 *     fires on every aggregated-health transition. Carries both the
 *     previous and new statuses so subscribers don't have to listen
 *     to two hooks and coalesce themselves.
 *
 * Actions:
 *   - `healthcheck.run_now`: enqueue a one-off run of a specific
 *     `(systemId, configurationId)` assignment. The recurring
 *     schedule keeps ticking; this just nudges the queue.
 *   - `healthcheck.enable_assignment` /
 *     `healthcheck.disable_assignment`: flip the `enabled` flag on an
 *     existing assignment via `service.setAssignmentEnabled`. Emits
 *     the existing `assignmentChanged` hook so the satellite-config
 *     relay picks up the change.
 *
 * Mutation actions emit hooks themselves (via the `emitHook` factory
 * dep) so downstream automations + caches react the same way as
 * RPC-driven mutations.
 */
import { z } from "zod";
import { Versioned, type Hook } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import type {
  ActionDefinition,
  TriggerDefinition,
} from "@checkstack/automation-backend";
import { makeEntityDrivenTriggerSetup } from "@checkstack/automation-backend";
import { HealthCheckStatusSchema } from "@checkstack/healthcheck-common";

import { healthCheckHooks } from "./hooks";
import {
  HEALTH_CHECK_QUEUE,
  type HealthCheckJobPayload,
} from "./queue-executor";
import type { HealthCheckService } from "./service";

// ─── Payload schemas — match the hook payloads exactly ─────────────────

// Phase 3b: the optional `environmentId` is present only for a PER-ENVIRONMENT
// health change (the env-qualified `health` entity id); it is ABSENT for the
// system-rollup change. Existing automations reading `systemId` are unaffected
// (the rollup carries the bare systemId); new automations can filter on
// `environmentId` to react to a specific environment's health.
const systemDegradedPayloadSchema = z.object({
  systemId: z.string(),
  environmentId: z.string().optional(),
  systemName: z.string().optional(),
  previousStatus: HealthCheckStatusSchema,
  newStatus: HealthCheckStatusSchema,
  healthyChecks: z.number(),
  totalChecks: z.number(),
  timestamp: z.string(),
});

const systemHealthyPayloadSchema = z.object({
  systemId: z.string(),
  environmentId: z.string().optional(),
  systemName: z.string().optional(),
  previousStatus: HealthCheckStatusSchema,
  healthyChecks: z.number(),
  totalChecks: z.number(),
  timestamp: z.string(),
});

const systemHealthChangedPayloadSchema = z.object({
  systemId: z.string(),
  environmentId: z.string().optional(),
  systemName: z.string().optional(),
  previousStatus: HealthCheckStatusSchema,
  newStatus: HealthCheckStatusSchema,
  healthyChecks: z.number(),
  totalChecks: z.number(),
  timestamp: z.string(),
});

const checkFailedPayloadSchema = z.object({
  systemId: z.string(),
  configurationId: z.string(),
  status: HealthCheckStatusSchema,
  latencyMs: z.number().optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string(),
});

// ─── Triggers ──────────────────────────────────────────────────────────

export const systemDegradedTrigger: TriggerDefinition<
  z.infer<typeof systemDegradedPayloadSchema>
> = {
  id: "system_degraded",
  displayName: "System Health Degraded",
  description:
    "Fires when a system's health transitions from healthy to degraded/unhealthy",
  category: "Health",
  icon: "HeartPulse",
  payloadSchema: systemDegradedPayloadSchema,
  // Entity-driven (§10.3): fired by the `health` entity change deriver via
  // Stage-1 routing, not a hook. No-op setup keeps it in the editor catalog.
  setup: makeEntityDrivenTriggerSetup<
    z.infer<typeof systemDegradedPayloadSchema>
  >(),
  contextKey: (p) => p.systemId,
  contextKeyLabel: "system",
};

export const systemHealthyTrigger: TriggerDefinition<
  z.infer<typeof systemHealthyPayloadSchema>
> = {
  id: "system_healthy",
  displayName: "System Health Restored",
  description: "Fires when a system's health recovers to healthy",
  category: "Health",
  icon: "HeartPulse",
  payloadSchema: systemHealthyPayloadSchema,
  // Entity-driven (§10.3): fired by the `health` entity change deriver.
  setup: makeEntityDrivenTriggerSetup<
    z.infer<typeof systemHealthyPayloadSchema>
  >(),
  contextKey: (p) => p.systemId,
  contextKeyLabel: "system",
};

export const systemHealthChangedTrigger: TriggerDefinition<
  z.infer<typeof systemHealthChangedPayloadSchema>
> = {
  id: "system_health_changed",
  displayName: "System Health Changed",
  description:
    "Fires on every aggregated-health transition — carries previous + new status",
  category: "Health",
  icon: "HeartPulse",
  payloadSchema: systemHealthChangedPayloadSchema,
  // Entity-driven (§10.3): fired by the `health` entity change deriver.
  setup: makeEntityDrivenTriggerSetup<
    z.infer<typeof systemHealthChangedPayloadSchema>
  >(),
  contextKey: (p) => p.systemId,
  contextKeyLabel: "system",
};

export const checkFailedTrigger: TriggerDefinition<
  z.infer<typeof checkFailedPayloadSchema>
> = {
  id: "check_failed",
  displayName: "Health Check Failed",
  description:
    "Fires when an individual check run completes with a non-`healthy` status",
  category: "Health",
  icon: "TriangleAlert",
  payloadSchema: checkFailedPayloadSchema,
  hook: healthCheckHooks.checkFailed,
  contextKey: (p) => p.systemId,
  contextKeyLabel: "system",
};

// The flapping trigger + its `flapping_detected` hook were removed. Flapping
// is now detected in the automation engine by a windowed-count gate on the
// `system_health_changed` trigger (raw change event + `filter` +
// `window: { count, minutes, refire: "once" }`) — no per-derived event.

// Triggers carry heterogeneous config types (all healthcheck triggers are
// currently config-less). The registry accepts the `<unknown, unknown>` shape
// and re-validates config against each trigger's own versioned `config` at load,
// so the registration array is widened here — mirroring
// `registerBuiltinTriggers` in automation-backend.
export const healthCheckTriggers: TriggerDefinition<unknown, unknown>[] = [
  systemDegradedTrigger as unknown as TriggerDefinition<unknown, unknown>,
  systemHealthyTrigger as unknown as TriggerDefinition<unknown, unknown>,
  systemHealthChangedTrigger as unknown as TriggerDefinition<unknown, unknown>,
  checkFailedTrigger as unknown as TriggerDefinition<unknown, unknown>,
];

// ─── Action configs ────────────────────────────────────────────────────

const runNowConfigSchema = z.object({
  systemId: z.string().min(1).describe("Target system id"),
  configurationId: z
    .string()
    .min(1)
    .describe("Target health-check configuration id"),
});

const assignmentToggleConfigSchema = z.object({
  systemId: z.string().min(1),
  configurationId: z.string().min(1),
});

// ─── Artifact ──────────────────────────────────────────────────────────

const assignmentArtifactSchema = z.object({
  systemId: z.string(),
  configurationId: z.string(),
  enabled: z.boolean().optional(),
  enqueued: z.boolean().optional(),
});

export type AssignmentArtifact = z.infer<typeof assignmentArtifactSchema>;

export const assignmentArtifactType = {
  id: "assignment",
  displayName: "Healthcheck Assignment",
  description:
    "Identifies the system↔configuration assignment touched by an automation action",
  schema: assignmentArtifactSchema,
} as const;

// ─── Action factory ────────────────────────────────────────────────────

export interface HealthCheckActionDeps {
  service: HealthCheckService;
  queueManager: QueueManager;
  emitHook: <T>(hook: Hook<T>, payload: T) => Promise<void>;
}

export function createHealthCheckActions(
  deps: HealthCheckActionDeps,
): ActionDefinition<unknown, unknown>[] {
  const runNow: ActionDefinition<
    z.infer<typeof runNowConfigSchema>,
    AssignmentArtifact
  > = {
    id: "run_now",
    displayName: "Run Health Check Now",
    description:
      "Enqueue a one-off run of the given assignment. Doesn't disturb the recurring schedule.",
    category: "Health",
    icon: "Play",
    config: new Versioned({ version: 1, schema: runNowConfigSchema }),
    produces: "assignment",
    execute: async ({ config, logger }) => {
      const queue = deps.queueManager.getQueue<HealthCheckJobPayload>(
        HEALTH_CHECK_QUEUE,
      );
      await queue.enqueue({
        configId: config.configurationId,
        systemId: config.systemId,
      });
      logger.info(
        `Automation enqueued run for ${config.systemId}:${config.configurationId}`,
      );
      return {
        success: true,
        externalId: `${config.systemId}:${config.configurationId}`,
        artifact: {
          systemId: config.systemId,
          configurationId: config.configurationId,
          enqueued: true,
        },
      };
    },
  };

  const enableAssignment: ActionDefinition<
    z.infer<typeof assignmentToggleConfigSchema>,
    AssignmentArtifact
  > = {
    id: "enable_assignment",
    displayName: "Enable Health Check Assignment",
    description:
      "Flip the `enabled` flag on an existing system↔configuration assignment to true.",
    category: "Health",
    icon: "Power",
    config: new Versioned({ version: 1, schema: assignmentToggleConfigSchema }),
    produces: "assignment",
    execute: async ({ config, logger }) => {
      const updated = await deps.service.setAssignmentEnabled(
        config.systemId,
        config.configurationId,
        true,
      );
      if (!updated) {
        return {
          success: false,
          error: `Assignment not found: ${config.systemId} ↔ ${config.configurationId}`,
        };
      }
      await deps.emitHook(healthCheckHooks.assignmentChanged, {
        systemId: config.systemId,
        configurationId: config.configurationId,
      });
      logger.info(
        `Automation enabled assignment ${config.systemId}:${config.configurationId}`,
      );
      return {
        success: true,
        externalId: `${config.systemId}:${config.configurationId}`,
        artifact: {
          systemId: config.systemId,
          configurationId: config.configurationId,
          enabled: true,
        },
      };
    },
  };

  const disableAssignment: ActionDefinition<
    z.infer<typeof assignmentToggleConfigSchema>,
    AssignmentArtifact
  > = {
    id: "disable_assignment",
    displayName: "Disable Health Check Assignment",
    description:
      "Flip the `enabled` flag on an existing system↔configuration assignment to false.",
    category: "Health",
    icon: "PowerOff",
    config: new Versioned({ version: 1, schema: assignmentToggleConfigSchema }),
    produces: "assignment",
    execute: async ({ config, logger }) => {
      const updated = await deps.service.setAssignmentEnabled(
        config.systemId,
        config.configurationId,
        false,
      );
      if (!updated) {
        return {
          success: false,
          error: `Assignment not found: ${config.systemId} ↔ ${config.configurationId}`,
        };
      }
      await deps.emitHook(healthCheckHooks.assignmentChanged, {
        systemId: config.systemId,
        configurationId: config.configurationId,
      });
      logger.info(
        `Automation disabled assignment ${config.systemId}:${config.configurationId}`,
      );
      return {
        success: true,
        externalId: `${config.systemId}:${config.configurationId}`,
        artifact: {
          systemId: config.systemId,
          configurationId: config.configurationId,
          enabled: false,
        },
      };
    },
  };

  return [
    runNow as ActionDefinition<unknown, unknown>,
    enableAssignment as ActionDefinition<unknown, unknown>,
    disableAssignment as ActionDefinition<unknown, unknown>,
  ];
}
