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
import { Versioned, type Hook } from "@checkstack/backend-api";
import type {
  ActionDefinition,
  TriggerDefinition,
} from "@checkstack/automation-backend";

import { catalogHooks } from "./hooks";
import type { EntityService } from "./services/entity-service";
import type { createCatalogCache } from "./cache";

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

export const systemCreatedTrigger: TriggerDefinition<
  z.infer<typeof systemCreatedPayloadSchema>
> = {
  id: "created",
  displayName: "System Created",
  description: "Fires when a new system is added to the catalog",
  category: "Catalog",
  icon: "Activity",
  payloadSchema: systemCreatedPayloadSchema,
  hook: catalogHooks.systemCreated,
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
  hook: catalogHooks.systemUpdated,
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
  hook: catalogHooks.systemDeleted,
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
   * `emitHook` bound during `afterPluginsReady`. Required so the
   * action fires `systemUpdated` downstream — without it, other
   * automations waiting on the trigger wouldn't see the change.
   */
  emitHook: <T>(hook: Hook<T>, payload: T) => Promise<void>;
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
    produces: "catalog.system_record",
    execute: async ({ config, logger }) => {
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

      const updated = await deps.entityService.updateSystem(config.systemId, {
        metadata: nextMetadata,
      });
      if (!updated) {
        return {
          success: false,
          error: `System ${config.systemId} disappeared mid-update`,
        };
      }

      await deps.cache.invalidateTopology();
      await deps.emitHook(catalogHooks.systemUpdated, {
        systemId: updated.id,
        systemName: updated.name,
        changedFields: ["metadata"],
      });

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
