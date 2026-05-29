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
import { HealthCheckStatusSchema } from "@checkstack/healthcheck-common";

import { healthCheckHooks } from "./hooks";
import {
  HEALTH_CHECK_QUEUE,
  type HealthCheckJobPayload,
} from "./queue-executor";
import type { HealthCheckService } from "./service";

// ─── Payload schemas — match the hook payloads exactly ─────────────────

const systemDegradedPayloadSchema = z.object({
  systemId: z.string(),
  systemName: z.string().optional(),
  previousStatus: HealthCheckStatusSchema,
  newStatus: HealthCheckStatusSchema,
  healthyChecks: z.number(),
  totalChecks: z.number(),
  timestamp: z.string(),
});

const systemHealthyPayloadSchema = z.object({
  systemId: z.string(),
  systemName: z.string().optional(),
  previousStatus: HealthCheckStatusSchema,
  healthyChecks: z.number(),
  totalChecks: z.number(),
  timestamp: z.string(),
});

const systemHealthChangedPayloadSchema = z.object({
  systemId: z.string(),
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

const flappingDetectedPayloadSchema = z.object({
  systemId: z.string(),
  configurationId: z.string(),
  transitionCount: z.number(),
  windowMinutes: z.number(),
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
  hook: healthCheckHooks.systemDegraded,
  contextKey: (p) => p.systemId,
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
  hook: healthCheckHooks.systemHealthy,
  contextKey: (p) => p.systemId,
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
  hook: healthCheckHooks.systemHealthChanged,
  contextKey: (p) => p.systemId,
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
};

export const flappingDetectedTrigger: TriggerDefinition<
  z.infer<typeof flappingDetectedPayloadSchema>
> = {
  id: "flapping_detected",
  displayName: "Health Check Flapping",
  description:
    "Fires when N unhealthy transitions are observed within the policy window. Re-fires on every additional transition while flapping; debounce in the automation if needed.",
  category: "Health",
  icon: "Repeat",
  payloadSchema: flappingDetectedPayloadSchema,
  hook: healthCheckHooks.flappingDetected,
  contextKey: (p) => p.systemId,
};

export const healthCheckTriggers: TriggerDefinition<unknown>[] = [
  systemDegradedTrigger as TriggerDefinition<unknown>,
  systemHealthyTrigger as TriggerDefinition<unknown>,
  systemHealthChangedTrigger as TriggerDefinition<unknown>,
  checkFailedTrigger as TriggerDefinition<unknown>,
  flappingDetectedTrigger as TriggerDefinition<unknown>,
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
    produces: "healthcheck.assignment",
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
    produces: "healthcheck.assignment",
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
    produces: "healthcheck.assignment",
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
