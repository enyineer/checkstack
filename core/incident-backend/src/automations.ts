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

// ─── Action configs ────────────────────────────────────────────────────

const incidentCreateConfigSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  severity: IncidentSeverityEnum,
  systemIds: z.array(z.string()).min(1),
  initialMessage: z.string().optional(),
  suppressNotifications: z.boolean().optional().default(false),
});

const incidentResolveConfigSchema = z.object({
  incidentId: z.string().min(1),
  message: z.string().optional(),
});

const incidentAddUpdateConfigSchema = z.object({
  incidentId: z.string().min(1),
  message: z.string().min(1),
  statusChange: IncidentStatusEnum.optional(),
});

const incidentUpdateStatusConfigSchema = z.object({
  incidentId: z.string().min(1),
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
    execute: async ({ config, logger }) => {
      const incident = await service.createIncident({
        title: config.title,
        description: config.description,
        severity: config.severity,
        systemIds: config.systemIds,
        initialMessage: config.initialMessage,
        suppressNotifications: config.suppressNotifications,
      });
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
    execute: async ({ config, logger }) => {
      const incident = await service.resolveIncident(
        config.incidentId,
        config.message,
      );
      if (!incident) {
        return {
          success: false,
          error: `Incident ${config.incidentId} not found`,
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
    execute: async ({ config, logger }) => {
      const update = await service.addUpdate({
        incidentId: config.incidentId,
        message: config.message,
        statusChange: config.statusChange,
      });
      logger.info(
        `Automation added update ${update.id} to incident ${config.incidentId}`,
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
    execute: async ({ config, logger }) => {
      const update = await service.addUpdate({
        incidentId: config.incidentId,
        message: config.message ?? `Status changed to ${config.status}`,
        statusChange: config.status,
      });
      logger.info(
        `Automation set incident ${config.incidentId} status → ${config.status}`,
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
