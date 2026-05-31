/**
 * Incident triggers + actions registered with the Automation platform.
 *
 * Triggers re-expose the existing incident hooks as automation entry
 * points; actions wrap the existing `IncidentService` methods so
 * operators can compose them into automation flows (e.g. "when an
 * incident is created, file a Jira ticket and post an update").
 *
 * Each trigger declares a `contextKey` extractor returning the
 * `incidentId` — the dispatch engine uses it to scope artifact lookups
 * and to match `wait_for_trigger` waits against the same incident.
 */
import { z } from "zod";
import { Versioned } from "@checkstack/backend-api";
import type {
  ActionDefinition,
  ArtifactTypeDefinition,
  TriggerDefinition,
} from "@checkstack/automation-backend";
import {
  IncidentSeverityEnum,
  IncidentStatusEnum,
} from "@checkstack/incident-common";

import { incidentHooks } from "./hooks";
import type { IncidentService } from "./service";

// ─── Payload schemas — match the hook payloads exactly ─────────────────

const incidentCreatedPayloadSchema = z.object({
  incidentId: z.string(),
  systemIds: z.array(z.string()),
  title: z.string(),
  description: z.string().optional(),
  severity: IncidentSeverityEnum,
  status: IncidentStatusEnum,
  createdAt: z.string(),
});

const incidentUpdatedPayloadSchema = z.object({
  incidentId: z.string(),
  systemIds: z.array(z.string()),
  title: z.string(),
  description: z.string().optional(),
  severity: IncidentSeverityEnum,
  status: IncidentStatusEnum,
  statusChange: IncidentStatusEnum.optional(),
});

const incidentResolvedPayloadSchema = z.object({
  incidentId: z.string(),
  systemIds: z.array(z.string()),
  title: z.string(),
  severity: IncidentSeverityEnum,
  resolvedAt: z.string(),
});

// ─── Triggers ──────────────────────────────────────────────────────────

export const incidentCreatedTrigger: TriggerDefinition<
  z.infer<typeof incidentCreatedPayloadSchema>
> = {
  id: "created",
  displayName: "Incident Created",
  description: "Fires when a new incident is created",
  category: "Incidents",
  icon: "CircleAlert",
  payloadSchema: incidentCreatedPayloadSchema,
  hook: incidentHooks.incidentCreated,
  contextKey: (p) => p.incidentId,
};

export const incidentUpdatedTrigger: TriggerDefinition<
  z.infer<typeof incidentUpdatedPayloadSchema>
> = {
  id: "updated",
  displayName: "Incident Updated",
  description: "Fires when an incident is updated (info or status change)",
  category: "Incidents",
  icon: "CircleAlert",
  payloadSchema: incidentUpdatedPayloadSchema,
  hook: incidentHooks.incidentUpdated,
  contextKey: (p) => p.incidentId,
};

export const incidentResolvedTrigger: TriggerDefinition<
  z.infer<typeof incidentResolvedPayloadSchema>
> = {
  id: "resolved",
  displayName: "Incident Resolved",
  description: "Fires when an incident is marked as resolved",
  category: "Incidents",
  icon: "CircleCheck",
  payloadSchema: incidentResolvedPayloadSchema,
  hook: incidentHooks.incidentResolved,
  contextKey: (p) => p.incidentId,
};

/**
 * All incident triggers as a heterogeneous list. Typed as
 * `TriggerDefinition<unknown>[]` so the array can be iterated in the
 * plugin entry without TypeScript collapsing the union to a single
 * payload shape.
 */
export const incidentTriggers: TriggerDefinition<unknown>[] = [
  incidentCreatedTrigger as TriggerDefinition<unknown>,
  incidentUpdatedTrigger as TriggerDefinition<unknown>,
  incidentResolvedTrigger as TriggerDefinition<unknown>,
];

// ─── incident artifact type ────────────────────────────────────────────

/**
 * The `incident` artifact represents an incident opened by an upstream
 * action (e.g. `incident.create`). Downstream actions in the same run
 * (`incident.resolve`, `incident.add_update`, `incident.update_status`)
 * can consume it to act on that incident without the operator repeating
 * the id — the open-then-wait-then-resolve flow the default auto-incident
 * automations rely on.
 */
const incidentDataSchema = z.object({
  incidentId: z.string(),
  status: z.string(),
  severity: z.string(),
  systemIds: z.array(z.string()),
});

export const incidentArtifactType: ArtifactTypeDefinition<
  z.infer<typeof incidentDataSchema>
> = {
  id: "incident",
  displayName: "Incident",
  description: "An incident opened by an upstream automation action",
  schema: incidentDataSchema,
};

// ─── Action configs ────────────────────────────────────────────────────

const incidentCreateConfigSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  severity: IncidentSeverityEnum,
  systemIds: z.array(z.string()).min(1),
  initialMessage: z.string().optional(),
  suppressNotifications: z.boolean().optional().default(false),
  /**
   * When true, reuse an existing OPEN incident on the first target
   * system instead of opening a duplicate (the old auto-incident
   * `findActiveAutoIncident(systemId)` semantic). The reused incident is
   * returned as the produced `incident` artifact so downstream
   * resolve/update actions still work. Default false — existing and
   * custom automations always create.
   */
  dedupe_open_for_system: z.boolean().optional().default(false),
});

// `incidentId` is optional on the close/update actions: when omitted the
// action falls back to the upstream `incident` artifact in run scope
// (config takes priority, else artifact). Mirrors Jira's resolveIssueKey.
const incidentResolveConfigSchema = z.object({
  incidentId: z
    .string()
    .optional()
    .describe("Defaults to the upstream incident artifact in the run."),
  message: z.string().optional(),
});

const incidentAddUpdateConfigSchema = z.object({
  incidentId: z
    .string()
    .optional()
    .describe("Defaults to the upstream incident artifact in the run."),
  message: z.string().min(1),
  statusChange: IncidentStatusEnum.optional(),
});

const incidentUpdateStatusConfigSchema = z.object({
  incidentId: z
    .string()
    .optional()
    .describe("Defaults to the upstream incident artifact in the run."),
  status: IncidentStatusEnum,
  /**
   * Optional accompanying message. Defaults to a generic transition note
   * so the audit trail is never empty.
   */
  message: z.string().optional(),
});

// ─── Action artifact shapes ────────────────────────────────────────────

interface IncidentArtifact {
  incidentId: string;
  status: string;
  severity: string;
  systemIds: string[];
}

interface IncidentUpdateArtifact {
  updateId: string;
  incidentId: string;
}

/**
 * Resolve an incident id from explicit config or fall back to the
 * upstream `incident` artifact in the run scope (config takes priority).
 * Mirrors Jira's `resolveIssueKey` pattern.
 */
function resolveIncidentId(
  configId: string | undefined,
  consumed: Record<string, unknown>,
): string | undefined {
  if (configId && configId.trim().length > 0) return configId;
  const incident = consumed["incident"];
  if (
    incident &&
    typeof incident === "object" &&
    "incidentId" in incident &&
    typeof (incident as { incidentId: unknown }).incidentId === "string"
  ) {
    return (incident as { incidentId: string }).incidentId;
  }
  return;
}

// ─── Actions ───────────────────────────────────────────────────────────

export interface IncidentActionDeps {
  service: IncidentService;
}

export function createIncidentActions(
  deps: IncidentActionDeps,
): ActionDefinition<unknown, unknown>[] {
  const { service } = deps;

  const createAction: ActionDefinition<
    z.infer<typeof incidentCreateConfigSchema>,
    IncidentArtifact
  > = {
    id: "create",
    displayName: "Create Incident",
    description: "Open a new incident affecting one or more systems",
    category: "Incidents",
    icon: "CircleAlert",
    config: new Versioned({
      version: 1,
      schema: incidentCreateConfigSchema,
    }),
    produces: "incident",
    execute: async ({ config, logger }) => {
      const createInput = {
        title: config.title,
        description: config.description,
        severity: config.severity,
        systemIds: config.systemIds,
        initialMessage: config.initialMessage,
        suppressNotifications: config.suppressNotifications,
      };

      // Per-system dedup (opt-in): if an open incident already exists on
      // the first target system, reuse it instead of opening a duplicate.
      // Reproduces the old auto-incident `findActiveAutoIncident` semantic
      // and keeps at most one open auto-incident per system across all the
      // default sustained/flapping automations. The check + create are
      // serialized per system inside the service (advisory lock), so two
      // concurrent triggers (e.g. sustained + flapping) for the same system
      // can't both find none and both create.
      if (config.dedupe_open_for_system) {
        const { incident, reused } =
          await service.createIncidentDedupedForSystem(
            createInput,
            config.systemIds[0]!,
          );
        if (reused) {
          logger.info(
            `Automation reused open incident ${incident.id} for system ${config.systemIds[0]} (dedupe)`,
          );
        } else {
          logger.info(`Automation created incident ${incident.id}`);
        }
        return {
          success: true,
          externalId: incident.id,
          artifact: {
            incidentId: incident.id,
            status: incident.status,
            severity: incident.severity,
            systemIds: incident.systemIds,
          },
        };
      }

      const incident = await service.createIncident(createInput);
      logger.info(`Automation created incident ${incident.id}`);
      return {
        success: true,
        externalId: incident.id,
        artifact: {
          incidentId: incident.id,
          status: incident.status,
          severity: incident.severity,
          systemIds: incident.systemIds,
        },
      };
    },
  };

  const resolveAction: ActionDefinition<
    z.infer<typeof incidentResolveConfigSchema>,
    IncidentArtifact
  > = {
    id: "resolve",
    displayName: "Resolve Incident",
    description: "Mark an existing incident as resolved",
    category: "Incidents",
    icon: "CircleCheck",
    config: new Versioned({
      version: 1,
      schema: incidentResolveConfigSchema,
    }),
    consumes: ["incident"],
    execute: async ({ config, consumedArtifacts, logger }) => {
      const incidentId = resolveIncidentId(config.incidentId, consumedArtifacts);
      if (!incidentId) {
        return {
          success: false,
          error: "No incidentId given and no upstream incident artifact found",
        };
      }
      const incident = await service.resolveIncident(incidentId, config.message);
      if (!incident) {
        return {
          success: false,
          error: `Incident ${incidentId} not found`,
        };
      }
      logger.info(`Automation resolved incident ${incident.id}`);
      return {
        success: true,
        externalId: incident.id,
        artifact: {
          incidentId: incident.id,
          status: incident.status,
          severity: incident.severity,
          systemIds: incident.systemIds,
        },
      };
    },
  };

  const addUpdateAction: ActionDefinition<
    z.infer<typeof incidentAddUpdateConfigSchema>,
    IncidentUpdateArtifact
  > = {
    id: "add_update",
    displayName: "Add Incident Update",
    description: "Post a status update to an existing incident",
    category: "Incidents",
    icon: "MessageSquare",
    config: new Versioned({
      version: 1,
      schema: incidentAddUpdateConfigSchema,
    }),
    consumes: ["incident"],
    execute: async ({ config, consumedArtifacts, logger }) => {
      const incidentId = resolveIncidentId(config.incidentId, consumedArtifacts);
      if (!incidentId) {
        return {
          success: false,
          error: "No incidentId given and no upstream incident artifact found",
        };
      }
      const update = await service.addUpdate({
        incidentId,
        message: config.message,
        statusChange: config.statusChange,
      });
      logger.info(
        `Automation added update ${update.id} to incident ${incidentId}`,
      );
      return {
        success: true,
        externalId: update.id,
        artifact: {
          updateId: update.id,
          incidentId: update.incidentId,
        },
      };
    },
  };

  const updateStatusAction: ActionDefinition<
    z.infer<typeof incidentUpdateStatusConfigSchema>,
    IncidentUpdateArtifact
  > = {
    id: "update_status",
    displayName: "Update Incident Status",
    description: "Change an incident's status and post an audit update",
    category: "Incidents",
    icon: "Activity",
    config: new Versioned({
      version: 1,
      schema: incidentUpdateStatusConfigSchema,
    }),
    consumes: ["incident"],
    execute: async ({ config, consumedArtifacts, logger }) => {
      const incidentId = resolveIncidentId(config.incidentId, consumedArtifacts);
      if (!incidentId) {
        return {
          success: false,
          error: "No incidentId given and no upstream incident artifact found",
        };
      }
      const update = await service.addUpdate({
        incidentId,
        message: config.message ?? `Status changed to ${config.status}`,
        statusChange: config.status,
      });
      logger.info(
        `Automation set incident ${incidentId} status → ${config.status}`,
      );
      return {
        success: true,
        externalId: update.id,
        artifact: {
          updateId: update.id,
          incidentId: update.incidentId,
        },
      };
    },
  };

  return [
    createAction as ActionDefinition<unknown, unknown>,
    resolveAction as ActionDefinition<unknown, unknown>,
    addUpdateAction as ActionDefinition<unknown, unknown>,
    updateStatusAction as ActionDefinition<unknown, unknown>,
  ];
}
