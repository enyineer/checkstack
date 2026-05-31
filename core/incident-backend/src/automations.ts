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
  EntityHandle,
  TriggerDefinition,
} from "@checkstack/automation-backend";
import { makeEntityDrivenTriggerSetup } from "@checkstack/automation-backend";
import {
  IncidentSeverityEnum,
  IncidentStatusEnum,
} from "@checkstack/incident-common";

import type { IncidentService } from "./service";
import {
  toIncidentEntityState,
  writeIncidentEntity,
  type IncidentEntityState,
} from "./incident-entity";

// ─── Payload schemas — match the hook payloads exactly ─────────────────

// NOTE (reactive entity payload mapper): the reactive `incident` entity state
// is only `{ status, severity, systemIds }`. The descriptive fields below
// (`title`, `description`, `createdAt`, `resolvedAt`) are NOT derivable from an
// entity change, so they are OPTIONAL — the entity-driven `trigger.payload`
// (see `incidentChangeToPayload`) carries `incidentId` / `systemIds` /
// `severity` / `status` / `statusChange` only. They stay in the schema for
// editor introspection / forward compatibility.
const incidentCreatedPayloadSchema = z.object({
  incidentId: z.string(),
  systemIds: z.array(z.string()),
  title: z.string().optional(),
  description: z.string().optional(),
  severity: IncidentSeverityEnum,
  status: IncidentStatusEnum,
  createdAt: z.string().optional(),
});

const incidentUpdatedPayloadSchema = z.object({
  incidentId: z.string(),
  systemIds: z.array(z.string()),
  title: z.string().optional(),
  description: z.string().optional(),
  severity: IncidentSeverityEnum,
  status: IncidentStatusEnum,
  statusChange: IncidentStatusEnum.optional(),
});

const incidentResolvedPayloadSchema = z.object({
  incidentId: z.string(),
  systemIds: z.array(z.string()),
  title: z.string().optional(),
  severity: IncidentSeverityEnum,
  resolvedAt: z.string().optional(),
});

// ─── Triggers ──────────────────────────────────────────────────────────

// These triggers are ENTITY-DRIVEN (§10.1): the `incident` entity's change
// deriver fires `incident.created/.updated/.resolved` via Stage-1 routing,
// so they no longer subscribe to a hook. A no-op `setup` keeps them in the
// editor's trigger catalog without re-introducing a hook.
export const incidentCreatedTrigger: TriggerDefinition<
  z.infer<typeof incidentCreatedPayloadSchema>
> = {
  id: "created",
  displayName: "Incident Created",
  description: "Fires when a new incident is created",
  category: "Incidents",
  icon: "CircleAlert",
  payloadSchema: incidentCreatedPayloadSchema,
  setup: makeEntityDrivenTriggerSetup<
    z.infer<typeof incidentCreatedPayloadSchema>
  >(),
  contextKey: (p) => p.incidentId,
};

export const incidentUpdatedTrigger: TriggerDefinition<
  z.infer<typeof incidentUpdatedPayloadSchema>
> = {
  id: "updated",
  displayName: "Incident Updated",
  description:
    "Fires when an incident's reactive state changes (status, severity, or affected systems). A comment-only update does not fire this trigger.",
  category: "Incidents",
  icon: "CircleAlert",
  payloadSchema: incidentUpdatedPayloadSchema,
  setup: makeEntityDrivenTriggerSetup<
    z.infer<typeof incidentUpdatedPayloadSchema>
  >(),
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
  setup: makeEntityDrivenTriggerSetup<
    z.infer<typeof incidentResolvedPayloadSchema>
  >(),
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
  /**
   * Resolver for the reactive `incident` entity (§10.1). When present, the
   * `incident.create` action drives its write through `handle.mutate` so an
   * action-created incident becomes reactive like any other (6(a)). Undefined
   * in tests / before the handle is wired — the create still runs, just
   * non-reactively.
   */
  getIncidentEntity?: () => EntityHandle<IncidentEntityState> | undefined;
}

export function createIncidentActions(
  deps: IncidentActionDeps,
): ActionDefinition<unknown, unknown>[] {
  const { service, getIncidentEntity } = deps;

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
    execute: async ({ config, logger, runId }) => {
      const createInput = {
        title: config.title,
        description: config.description,
        severity: config.severity,
        systemIds: config.systemIds,
        initialMessage: config.initialMessage,
        suppressNotifications: config.suppressNotifications,
      };
      const handle = getIncidentEntity?.();

      // Per-system dedup (opt-in): if an open incident already exists on
      // the first target system, reuse it instead of opening a duplicate.
      // Reproduces the old auto-incident `findActiveAutoIncident` semantic
      // and keeps at most one open auto-incident per system across all the
      // default sustained/flapping automations. The check + create are
      // serialized per system inside the service (advisory lock), so two
      // concurrent triggers (e.g. sustained + flapping) for the same system
      // can't both find none and both create.
      //
      // 6(a): an action-created incident is now reactive — the create runs
      // through `handle.mutate`, so the deriver fires `incident.created` and
      // automations can trigger on it. A REUSED incident drives NO entity
      // write (it already exists and is unchanged, so no duplicate
      // `incident.created`). The id is generated up front so a real create's
      // `prev` snapshot reads the not-yet-existing row as absent.
      if (config.dedupe_open_for_system) {
        const newId = crypto.randomUUID();
        // The create (when not reused) runs INSIDE the dedup lock via
        // `onCreate`, driven through `handle.mutate` so `prev` is snapshotted
        // (absent → null) BEFORE the insert and `incident.created` fires. A
        // REUSE never calls `onCreate`, so no entity write and no duplicate
        // `incident.created` — matching the pre-reactive dedupe behavior.
        const { incident, reused } =
          await service.createIncidentDedupedForSystem(
            createInput,
            config.systemIds[0]!,
            undefined,
            newId,
            async (create) => {
              let created!: Awaited<ReturnType<typeof create>>;
              await writeIncidentEntity({
                handle,
                incidentId: newId,
                opts: { runId },
                apply: async () => {
                  created = await create();
                  return toIncidentEntityState(created);
                },
              });
              return created;
            },
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

      const newId = crypto.randomUUID();
      let incident!: Awaited<ReturnType<typeof service.createIncident>>;
      await writeIncidentEntity({
        handle,
        incidentId: newId,
        opts: { runId },
        apply: async () => {
          incident = await service.createIncident(createInput, undefined, newId);
          return toIncidentEntityState(incident);
        },
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
    consumes: ["incident"],
    execute: async ({ config, consumedArtifacts, logger, runId }) => {
      const incidentId = resolveIncidentId(config.incidentId, consumedArtifacts);
      if (!incidentId) {
        return {
          success: false,
          error: "No incidentId given and no upstream incident artifact found",
        };
      }
      // Guard existence BEFORE the driven write so `apply` never throws on a
      // missing incident (a graceful action failure, not a run error).
      if (!(await service.getIncident(incidentId))) {
        return {
          success: false,
          error: `Incident ${incidentId} not found`,
        };
      }
      // 6(a): route the resolve through the reactive `incident` entity (like
      // the RPC router) so the status flip appends an `entity_transitions` row,
      // emits `ENTITY_CHANGED` (waking any `wait_until`), and fires the
      // `incident.resolved` deriver. `apply` performs the REAL resolve and
      // re-reads the post-write state inside the mutate window. `opts.runId`
      // masks any run-resolved secret that lands in the reactive state.
      const captured: {
        incident: NonNullable<
          Awaited<ReturnType<typeof service.resolveIncident>>
        > | null;
      } = { incident: null };
      await writeIncidentEntity({
        handle: getIncidentEntity?.(),
        incidentId,
        opts: { runId },
        apply: async () => {
          const resolved = await service.resolveIncident(
            incidentId,
            config.message,
          );
          if (!resolved) {
            throw new Error(`Incident ${incidentId} not found`);
          }
          captured.incident = resolved;
          return toIncidentEntityState(resolved);
        },
      });
      const incident = captured.incident;
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
    execute: async ({ config, consumedArtifacts, logger, runId }) => {
      const incidentId = resolveIncidentId(config.incidentId, consumedArtifacts);
      if (!incidentId) {
        return {
          success: false,
          error: "No incidentId given and no upstream incident artifact found",
        };
      }
      // 6(a): route the update through the reactive `incident` entity (like the
      // RPC router). `apply` posts the update row + (optionally) flips status,
      // then re-reads the post-write reactive state. When `statusChange` flips
      // the status to resolved the deriver fires `incident.resolved`; any other
      // status change fires `incident.updated`; an update with no status change
      // is a no-op diff (no event). `opts.runId` masks run-resolved secrets.
      const captured: {
        update: Awaited<ReturnType<typeof service.addUpdate>> | null;
      } = { update: null };
      await writeIncidentEntity({
        handle: getIncidentEntity?.(),
        incidentId,
        opts: { runId },
        apply: async () => {
          captured.update = await service.addUpdate({
            incidentId,
            message: config.message,
            statusChange: config.statusChange,
          });
          const incident = await service.getIncident(incidentId);
          if (!incident) {
            throw new Error(`Incident ${incidentId} not found`);
          }
          return toIncidentEntityState(incident);
        },
      });
      const update = captured.update;
      if (!update) {
        return {
          success: false,
          error: `Incident ${incidentId} not found`,
        };
      }
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
    execute: async ({ config, consumedArtifacts, logger, runId }) => {
      const incidentId = resolveIncidentId(config.incidentId, consumedArtifacts);
      if (!incidentId) {
        return {
          success: false,
          error: "No incidentId given and no upstream incident artifact found",
        };
      }
      // 6(a): route the status flip through the reactive `incident` entity
      // (like the RPC router) so it appends an `entity_transitions` row, emits
      // `ENTITY_CHANGED` (waking any `wait_until`), and fires `incident.resolved`
      // (→ resolved) or `incident.updated`. `apply` performs the REAL write +
      // re-reads post-write state. `opts.runId` masks run-resolved secrets.
      const captured: {
        update: Awaited<ReturnType<typeof service.addUpdate>> | null;
      } = { update: null };
      await writeIncidentEntity({
        handle: getIncidentEntity?.(),
        incidentId,
        opts: { runId },
        apply: async () => {
          captured.update = await service.addUpdate({
            incidentId,
            message: config.message ?? `Status changed to ${config.status}`,
            statusChange: config.status,
          });
          const incident = await service.getIncident(incidentId);
          if (!incident) {
            throw new Error(`Incident ${incidentId} not found`);
          }
          return toIncidentEntityState(incident);
        },
      });
      const update = captured.update;
      if (!update) {
        return {
          success: false,
          error: `Incident ${incidentId} not found`,
        };
      }
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
