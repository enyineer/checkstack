/**
 * Catalog triggers + actions registered with the Automation Platform.
 *
 * Triggers re-expose the existing `catalogHooks` as automation entry
 * points (`system.created`, `system.updated`, `system.deleted`).
 * Actions wrap the existing `EntityService` so operators can mutate
 * systems from automation flows (e.g. "when an incident is resolved,
 * clear the system's `incident_severity` metadata field").
 *
 * `system.set_maintenance` / `system.clear_maintenance` are NOT in
 * this file — those wrap maintenance-backend RPCs and ship as part of
 * the maintenance Phase 9 chunk. `system.health_changed` is owned by
 * the healthcheck chunk where the aggregation data lives.
 *
 * Action handlers call `entityService.updateSystem` directly and then
 * invalidate the catalog topology cache + emit the `systemUpdated`
 * hook themselves. The router handler does the same thing for
 * RPC-driven edits; centralising it in the service would be a
 * separate refactor (covered elsewhere). For now, both paths emit the
 * hook so downstream automations + cache subscribers see the change.
 */
import { z } from "zod";
import { Versioned } from "@checkstack/backend-api";
import type {
  ActionDefinition,
  TriggerDefinition,
} from "@checkstack/automation-backend";
import {
  makeEntityDrivenTriggerSetup,
  type EntityHandle,
} from "@checkstack/automation-backend";
import type { EntityService } from "./services/entity-service";
import type { createCatalogCache } from "./cache";
import {
  toCatalogSystemState,
  writeCatalogSystemEntity,
  type CatalogSystemState,
} from "./catalog-entity";

// ─── Payload schemas — match the hook payloads exactly ─────────────────

const systemCreatedPayloadSchema = z.object({
  systemId: z.string(),
  systemName: z.string(),
});

const systemUpdatedPayloadSchema = z.object({
  systemId: z.string(),
  systemName: z.string(),
  changedFields: z.array(z.enum(["name", "description", "metadata"])),
});

const systemDeletedPayloadSchema = z.object({
  systemId: z.string(),
  systemName: z.string().optional(),
});

// ─── Triggers ──────────────────────────────────────────────────────────

// These triggers are ENTITY-DRIVEN (§10.4): the `catalog-system` entity's
// change deriver fires `catalog.created/.updated/.deleted` via Stage-1
// routing, so they no longer subscribe to a hook. A no-op `setup` keeps
// them in the editor's trigger catalog without re-introducing a hook.
export const systemCreatedTrigger: TriggerDefinition<
  z.infer<typeof systemCreatedPayloadSchema>
> = {
  id: "created",
  displayName: "System Created",
  description: "Fires when a new system is added to the catalog",
  category: "Catalog",
  icon: "Activity",
  payloadSchema: systemCreatedPayloadSchema,
  setup: makeEntityDrivenTriggerSetup<
    z.infer<typeof systemCreatedPayloadSchema>
  >(),
  contextKey: (p) => p.systemId,
};

export const systemUpdatedTrigger: TriggerDefinition<
  z.infer<typeof systemUpdatedPayloadSchema>
> = {
  id: "updated",
  displayName: "System Updated",
  description: "Fires when a system's name, description, or metadata changes",
  category: "Catalog",
  icon: "Activity",
  payloadSchema: systemUpdatedPayloadSchema,
  setup: makeEntityDrivenTriggerSetup<
    z.infer<typeof systemUpdatedPayloadSchema>
  >(),
  contextKey: (p) => p.systemId,
};

export const systemDeletedTrigger: TriggerDefinition<
  z.infer<typeof systemDeletedPayloadSchema>
> = {
  id: "deleted",
  displayName: "System Deleted",
  description: "Fires when a system is removed from the catalog",
  category: "Catalog",
  icon: "Activity",
  payloadSchema: systemDeletedPayloadSchema,
  setup: makeEntityDrivenTriggerSetup<
    z.infer<typeof systemDeletedPayloadSchema>
  >(),
  contextKey: (p) => p.systemId,
};

export const catalogTriggers: TriggerDefinition<unknown>[] = [
  systemCreatedTrigger as TriggerDefinition<unknown>,
  systemUpdatedTrigger as TriggerDefinition<unknown>,
  systemDeletedTrigger as TriggerDefinition<unknown>,
];

// ─── Action: system.update_metadata ────────────────────────────────────

const systemUpdateMetadataConfigSchema = z.object({
  systemId: z.string().min(1).describe("Target system id"),
  /**
   * Strategy for combining `metadata` with the system's existing
   * metadata object:
   *   - `merge` (default): shallow-merge — preserves untouched keys.
   *   - `replace`: overwrite the entire metadata object.
   */
  strategy: z.enum(["merge", "replace"]).default("merge"),
  metadata: z
    .record(z.string(), z.unknown())
    .describe("New metadata key-value pairs"),
});

export type SystemUpdateMetadataConfig = z.infer<
  typeof systemUpdateMetadataConfigSchema
>;

const systemRecordArtifactSchema = z.object({
  systemId: z.string(),
  systemName: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

export type SystemRecordArtifact = z.infer<typeof systemRecordArtifactSchema>;

export const systemRecordArtifactType = {
  id: "system_record",
  displayName: "System Record",
  description: "Snapshot of a system after an automation-driven change",
  schema: systemRecordArtifactSchema,
} as const;

export interface CatalogActionDeps {
  entityService: EntityService;
  cache: ReturnType<typeof createCatalogCache>;
  /**
   * Resolver for the reactive `catalog-system` entity (§10.4). The
   * `update_metadata` action mirrors its edit here; the entity's change
   * deriver fires the `catalog.updated` trigger event downstream (the old
   * `systemUpdated` hook emission was removed).
   */
  getSystemEntity?: () => EntityHandle<CatalogSystemState> | undefined;
}

export function createCatalogActions(
  deps: CatalogActionDeps,
): ActionDefinition<unknown, unknown>[] {
  const updateMetadata: ActionDefinition<
    SystemUpdateMetadataConfig,
    SystemRecordArtifact
  > = {
    id: "update_metadata",
    displayName: "Update System Metadata",
    description:
      "Set or merge metadata keys on a system. Useful for cross-plugin state (e.g. flagging a system from an automation).",
    category: "Catalog",
    icon: "FilePenLine",
    config: new Versioned({
      version: 1,
      schema: systemUpdateMetadataConfigSchema,
    }),
    produces: "system_record",
    execute: async ({ config, logger, runId }) => {
      const existing = await deps.entityService.getSystem(config.systemId);
      if (!existing) {
        return {
          success: false,
          error: `System not found: ${config.systemId}`,
        };
      }

      const existingMetadata =
        (existing.metadata as Record<string, unknown> | null) ?? {};
      const nextMetadata =
        config.strategy === "replace"
          ? config.metadata
          : { ...existingMetadata, ...config.metadata };

      // Drive the update through the reactive `catalog-system` entity (§10.4);
      // the REAL `updateSystem` runs INSIDE `apply`, so `prev` is snapshotted
      // before the write and the deriver fires `catalog.updated`. If the row
      // was race-deleted mid-update, `apply` falls back to the pre-write
      // state so the diff is a no-op (no spurious `catalog.updated`), and the
      // failure is surfaced from the captured `updated`.
      // Capture the post-write row in a holder so TS control-flow tracks the
      // assignment made inside the async `apply` closure (a plain `let`
      // mutated in a closure is invisible to CFA and would narrow to `never`).
      const captured: {
        row: Awaited<ReturnType<typeof deps.entityService.updateSystem>> | null;
      } = { row: null };
      await writeCatalogSystemEntity({
        handle: deps.getSystemEntity?.(),
        systemId: config.systemId,
        // Run-secret masking choke point: this action resolves config
        // (including `metadata` values) against the run scope, which can
        // contain run-resolved secrets. Passing `runId` masks any such secret
        // in the `entity_transitions` rows + the cluster-wide `ENTITY_CHANGED`.
        opts: { runId },
        apply: async () => {
          const row = await deps.entityService.updateSystem(config.systemId, {
            metadata: nextMetadata,
          });
          captured.row = row ?? null;
          return toCatalogSystemState({
            name: row?.name ?? existing.name,
            description: row?.description ?? existing.description,
            metadata: row ? nextMetadata : existingMetadata,
          });
        },
      });
      const updated = captured.row;
      if (!updated) {
        return {
          success: false,
          error: `System ${config.systemId} disappeared mid-update`,
        };
      }

      await deps.cache.invalidateTopology();

      logger.info(
        `Automation updated metadata on system ${updated.id} (${config.strategy})`,
      );
      return {
        success: true,
        externalId: updated.id,
        artifact: {
          systemId: updated.id,
          systemName: updated.name,
          metadata: nextMetadata,
        },
      };
    },
  };

  return [updateMetadata as ActionDefinition<unknown, unknown>];
}
