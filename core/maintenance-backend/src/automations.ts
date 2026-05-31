/**
 * Maintenance actions registered with the Automation Platform.
 *
 * The `maintenance.created` / `maintenance.updated` entry points used to be
 * hook-backed triggers re-exposing `maintenanceHooks`. Phase 4 (reactive
 * automation engine §10.2) migrated the maintenance domain onto the entity
 * state machine, and the domain is now a Model-B PLUGIN-BACKED entity: the
 * `maintenances` table IS the current-state storage. The triggers + their
 * hooks are removed, and the same qualified trigger event ids are derived
 * from `maintenance` entity changes (see `./entity.ts`). Mutation actions
 * therefore drive the REAL write through `handle.mutate` (the write runs
 * inside `apply`) instead of emitting a hook; the deriver re-fires the
 * equivalent trigger events for downstream automations.
 *
 * Actions wrap `MaintenanceService` for `create`, `update`, and
 * `add_update`, plus two "system-shaped" actions:
 *
 *   - `set_system`: schedule a maintenance window that starts now and
 *     covers a single system, for a given duration. The convenient
 *     "park this system for an hour" operation.
 *   - `clear_system`: close every active/scheduled maintenance that
 *     covers a given system. The convenient "let it back into rotation
 *     even if maintenance was over-scheduled" operation.
 */
import { z } from "zod";
import { Versioned } from "@checkstack/backend-api";
import type { ActionDefinition, EntityHandle } from "@checkstack/automation-backend";
import { SYSTEM_ACTOR } from "@checkstack/common";
import {
  MaintenanceStatusEnum,
  type MaintenanceStatus,
} from "@checkstack/maintenance-common";

import type {
  ActionRunScope,
  EntityMutationOpts,
} from "@checkstack/automation-backend";
import type { MaintenanceService } from "./service";
import {
  toMaintenanceEntityState,
  writeMaintenanceEntity,
  type MaintenanceEntityState,
} from "./entity";

/**
 * Mutation opts for an action-originated entity write: the run id (so
 * run-secret masking applies to the persisted state — reactive automation
 * engine §3.5) + the run's actor (so the derived change event carries the
 * same actor the firing trigger had).
 */
function mutationOpts(args: {
  runId: string;
  scope?: ActionRunScope;
}): EntityMutationOpts {
  return {
    runId: args.runId,
    actor: args.scope?.trigger.actor ?? SYSTEM_ACTOR,
  };
}

// ─── Action configs ────────────────────────────────────────────────────

const createConfigSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  systemIds: z.array(z.string()).min(1),
  startAt: z
    .string()
    .describe("ISO timestamp when the window starts"),
  endAt: z.string().describe("ISO timestamp when the window ends"),
  suppressNotifications: z.boolean().optional().default(false),
});

const updateConfigSchema = z.object({
  maintenanceId: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  systemIds: z.array(z.string()).optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  suppressNotifications: z.boolean().optional(),
});

const addUpdateConfigSchema = z.object({
  maintenanceId: z.string().min(1),
  message: z.string().min(1),
  statusChange: MaintenanceStatusEnum.optional(),
});

const setSystemConfigSchema = z.object({
  systemId: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  durationMinutes: z
    .number()
    .int()
    .min(1)
    .max(30 * 24 * 60)
    .describe("Window length in minutes (1 min – 30 days)"),
  suppressNotifications: z.boolean().optional().default(false),
});

const clearSystemConfigSchema = z.object({
  systemId: z.string().min(1),
  message: z
    .string()
    .optional()
    .describe(
      "Note appended to the maintenance update log; defaults to a generic 'cleared by automation' message",
    ),
});

// ─── Artifact ──────────────────────────────────────────────────────────

const maintenanceArtifactSchema = z.object({
  maintenanceId: z.string(),
  status: MaintenanceStatusEnum,
  systemIds: z.array(z.string()),
  startAt: z.string(),
  endAt: z.string(),
});

export type MaintenanceArtifact = z.infer<typeof maintenanceArtifactSchema>;

export const maintenanceArtifactType = {
  id: "window",
  displayName: "Maintenance Window",
  description: "Maintenance row touched (created/updated/closed) by an automation",
  schema: maintenanceArtifactSchema,
} as const;

// ─── Action factory ────────────────────────────────────────────────────

export interface MaintenanceActionDeps {
  service: MaintenanceService;
  /**
   * Reactive `maintenance` entity handle (PLUGIN-BACKED, §10.2). Driving a
   * window's write through `handle.mutate` (the REAL write runs inside
   * `apply`, instead of emitting the old `maintenance.created`/`.updated`
   * hooks) is what re-fires the equivalent trigger events for downstream
   * automations via the change-deriver.
   */
  entityHandle: EntityHandle<MaintenanceEntityState>;
  /**
   * Override for `Date.now()`. Only used by `set_system` to compute
   * `endAt = now + durationMinutes`. Tests inject a fixed clock; the
   * default uses the real wall clock.
   */
  now?: () => Date;
}

function toArtifact(maint: {
  id: string;
  status: MaintenanceStatus;
  systemIds: string[];
  startAt: Date | string;
  endAt: Date | string;
}): MaintenanceArtifact {
  return {
    maintenanceId: maint.id,
    status: maint.status,
    systemIds: maint.systemIds,
    startAt:
      maint.startAt instanceof Date ? maint.startAt.toISOString() : maint.startAt,
    endAt: maint.endAt instanceof Date ? maint.endAt.toISOString() : maint.endAt,
  };
}

export function createMaintenanceActions(
  deps: MaintenanceActionDeps,
): ActionDefinition<unknown, unknown>[] {
  const now = deps.now ?? (() => new Date());

  const createAction: ActionDefinition<
    z.infer<typeof createConfigSchema>,
    MaintenanceArtifact
  > = {
    id: "create",
    displayName: "Schedule Maintenance",
    description: "Schedule a new maintenance window",
    category: "Maintenance",
    icon: "Wrench",
    config: new Versioned({ version: 1, schema: createConfigSchema }),
    produces: "maintenance.window",
    execute: async ({ config, logger, runId, scope }) => {
      // Drive the create through the reactive `maintenance` entity (§10.2):
      // the REAL write runs inside `apply` and the deriver fires
      // `maintenance.created`. The id is generated up front so the create's
      // `prev` snapshot reads the not-yet-existing row as absent.
      const maintenanceId = crypto.randomUUID();
      let created!: Awaited<ReturnType<typeof deps.service.createMaintenance>>;
      await writeMaintenanceEntity({
        handle: deps.entityHandle,
        maintenanceId,
        opts: mutationOpts({ runId, scope }),
        apply: async () => {
          created = await deps.service.createMaintenance(
            {
              title: config.title,
              description: config.description,
              systemIds: config.systemIds,
              startAt: new Date(config.startAt),
              endAt: new Date(config.endAt),
              suppressNotifications: config.suppressNotifications,
            },
            maintenanceId,
          );
          return toMaintenanceEntityState(created);
        },
      });
      const artifact = toArtifact(created);
      logger.info(`Automation scheduled maintenance ${created.id}`);
      return {
        success: true,
        externalId: created.id,
        artifact,
      };
    },
  };

  const updateAction: ActionDefinition<
    z.infer<typeof updateConfigSchema>,
    MaintenanceArtifact
  > = {
    id: "update",
    displayName: "Update Maintenance",
    description: "Update an existing maintenance window's metadata or schedule",
    category: "Maintenance",
    icon: "Wrench",
    config: new Versioned({ version: 1, schema: updateConfigSchema }),
    produces: "maintenance.window",
    execute: async ({ config, logger, runId, scope }) => {
      // Probe existence first so a missing window returns a clean failure
      // without driving an entity write (no `prev` to snapshot).
      const exists = await deps.service.getMaintenance(config.maintenanceId);
      if (!exists) {
        return {
          success: false,
          error: `Maintenance not found: ${config.maintenanceId}`,
        };
      }
      // Drive the update through the reactive `maintenance` entity (§10.2);
      // the REAL write runs inside `apply` and the deriver fires
      // `maintenance.updated`.
      let updated!: NonNullable<
        Awaited<ReturnType<typeof deps.service.updateMaintenance>>
      >;
      await writeMaintenanceEntity({
        handle: deps.entityHandle,
        maintenanceId: config.maintenanceId,
        opts: mutationOpts({ runId, scope }),
        apply: async () => {
          const result = await deps.service.updateMaintenance({
            id: config.maintenanceId,
            title: config.title,
            description: config.description,
            systemIds: config.systemIds,
            startAt: config.startAt ? new Date(config.startAt) : undefined,
            endAt: config.endAt ? new Date(config.endAt) : undefined,
            suppressNotifications: config.suppressNotifications,
          });
          if (!result) {
            throw new Error(`Maintenance not found: ${config.maintenanceId}`);
          }
          updated = result;
          return toMaintenanceEntityState(updated);
        },
      });
      const artifact = toArtifact(updated);
      logger.info(`Automation updated maintenance ${updated.id}`);
      return { success: true, externalId: updated.id, artifact };
    },
  };

  const addUpdateAction: ActionDefinition<
    z.infer<typeof addUpdateConfigSchema>,
    MaintenanceArtifact
  > = {
    id: "add_update",
    displayName: "Add Maintenance Update",
    description: "Append a status-update note to a maintenance window",
    category: "Maintenance",
    icon: "MessageSquarePlus",
    config: new Versioned({ version: 1, schema: addUpdateConfigSchema }),
    produces: "maintenance.window",
    execute: async ({ config, logger, runId, scope }) => {
      // Drive the update through the reactive `maintenance` entity (§10.2):
      // `apply` posts the update row + (optionally) flips status, then
      // re-reads the post-write state. The deriver fires `maintenance.updated`
      // purely from the entity diff (no diff → no event).
      let refreshed: Awaited<ReturnType<typeof deps.service.getMaintenance>>;
      let missing = false;
      await writeMaintenanceEntity({
        handle: deps.entityHandle,
        maintenanceId: config.maintenanceId,
        opts: mutationOpts({ runId, scope }),
        apply: async () => {
          await deps.service.addUpdate({
            maintenanceId: config.maintenanceId,
            message: config.message,
            statusChange: config.statusChange,
          });
          // Re-fetch so we surface the latest window state to the next step +
          // so the entity state matches the (now-updated) row.
          refreshed = await deps.service.getMaintenance(config.maintenanceId);
          if (!refreshed) {
            missing = true;
            throw new Error(
              `Maintenance ${config.maintenanceId} not found after update`,
            );
          }
          return toMaintenanceEntityState(refreshed);
        },
      }).catch((error) => {
        // The "vanished mid-write" case is a soft failure for the action, not
        // a thrown run error; rethrow anything else.
        if (!missing) throw error;
      });
      if (!refreshed) {
        return {
          success: false,
          error: `Maintenance ${config.maintenanceId} not found after update`,
        };
      }
      const artifact = toArtifact(refreshed);
      logger.info(`Automation added update to maintenance ${refreshed.id}`);
      return { success: true, externalId: refreshed.id, artifact };
    },
  };

  const setSystemAction: ActionDefinition<
    z.infer<typeof setSystemConfigSchema>,
    MaintenanceArtifact
  > = {
    id: "set_system",
    displayName: "Set System Maintenance",
    description:
      "Schedule a maintenance window covering a single system, starting now and lasting `durationMinutes` minutes.",
    category: "Maintenance",
    icon: "Wrench",
    config: new Versioned({ version: 1, schema: setSystemConfigSchema }),
    produces: "maintenance.window",
    execute: async ({ config, logger, runId, scope }) => {
      const startAt = now();
      const endAt = new Date(
        startAt.getTime() + config.durationMinutes * 60_000,
      );
      // Drive the create through the reactive `maintenance` entity (§10.2):
      // the REAL write runs inside `apply` and the deriver fires
      // `maintenance.created`. The id is generated up front so the create's
      // `prev` snapshot reads the not-yet-existing row as absent.
      const maintenanceId = crypto.randomUUID();
      let created!: Awaited<ReturnType<typeof deps.service.createMaintenance>>;
      await writeMaintenanceEntity({
        handle: deps.entityHandle,
        maintenanceId,
        opts: mutationOpts({ runId, scope }),
        apply: async () => {
          created = await deps.service.createMaintenance(
            {
              title:
                config.title ?? `Automation maintenance (${config.systemId})`,
              description: config.description,
              systemIds: [config.systemId],
              startAt,
              endAt,
              suppressNotifications: config.suppressNotifications,
            },
            maintenanceId,
          );
          return toMaintenanceEntityState(created);
        },
      });
      const artifact = toArtifact(created);
      logger.info(
        `Automation parked system ${config.systemId} via maintenance ${created.id}`,
      );
      return { success: true, externalId: created.id, artifact };
    },
  };

  interface ClearSystemArtifact {
    systemId: string;
    closedMaintenanceIds: string[];
  }

  const clearSystemAction: ActionDefinition<
    z.infer<typeof clearSystemConfigSchema>,
    ClearSystemArtifact
  > = {
    id: "clear_system",
    displayName: "Clear System Maintenance",
    description:
      "Close every active or scheduled maintenance window that covers this system.",
    category: "Maintenance",
    icon: "Wrench",
    config: new Versioned({ version: 1, schema: clearSystemConfigSchema }),
    produces: "maintenance.window",
    execute: async ({ config, logger, runId, scope }) => {
      const active = await deps.service.getMaintenancesForSystem(config.systemId);
      const closedIds: string[] = [];
      const message = config.message ?? "Cleared by automation";
      for (const window of active) {
        // Drive each close through the reactive `maintenance` entity (§10.2):
        // the REAL close runs inside `apply` and the deriver fires
        // `maintenance.updated` from the status → completed transition.
        let closed: Awaited<ReturnType<typeof deps.service.closeMaintenance>>;
        await writeMaintenanceEntity({
          handle: deps.entityHandle,
          maintenanceId: window.id,
          opts: mutationOpts({ runId, scope }),
          apply: async () => {
            closed = await deps.service.closeMaintenance(window.id, message);
            // Fall back to the pre-close window so the diff is a no-op when the
            // row vanished mid-write (the loop just skips it below).
            return toMaintenanceEntityState(closed ?? window);
          },
        });
        if (!closed) continue;
        closedIds.push(closed.id);
      }
      logger.info(
        `Automation cleared maintenance for system ${config.systemId} (${closedIds.length} window(s))`,
      );
      return {
        success: true,
        externalId: config.systemId,
        artifact: { systemId: config.systemId, closedMaintenanceIds: closedIds },
      };
    },
  };

  return [
    createAction as ActionDefinition<unknown, unknown>,
    updateAction as ActionDefinition<unknown, unknown>,
    addUpdateAction as ActionDefinition<unknown, unknown>,
    setSystemAction as ActionDefinition<unknown, unknown>,
    clearSystemAction as ActionDefinition<unknown, unknown>,
  ];
}
