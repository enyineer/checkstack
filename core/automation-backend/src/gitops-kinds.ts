/**
 * GitOps `Automation` entity kind (Phase 21).
 *
 * Registers `Automation` with the GitOps entity-kind registry so an
 * automation's full `AutomationDefinitionSchema` can be declared in YAML
 * and reconciled into the `automations` table. Mirrors the System kind
 * registration in `catalog-backend`.
 *
 * Reconcile is upsert-by-name (identity tracked by the GitOps engine via
 * the returned `entityId` + provenance): first sight creates, later
 * sights update in place. Reconciled rows carry `managed_by = "gitops"`
 * so the UI can show them as declaratively managed and lock the editor
 * (the provenance lock is what actually gates the UI; `managed_by` is the
 * origin marker).
 */
import { and, eq } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";
import {
  AutomationDefinitionSchema,
  type AutomationDefinition,
} from "@checkstack/automation-common";

import { automations } from "./schema";
import * as schema from "./schema";

type Db = SafeDatabase<typeof schema>;

/** Origin marker stamped on GitOps-managed automations. */
export const GITOPS_MANAGED_BY = "gitops";

/**
 * Metadata label key carrying the automation's grouping label. GitOps has no
 * dedicated `group` metadata field, so a declaratively-managed automation
 * expresses its group via `metadata.labels.group`. Mirrors how `name` /
 * `description` come from `metadata`, keeping `group` out of the spec
 * (definition) tier — consistent with it being a row column, not part of the
 * definition YAML.
 */
export const GITOPS_GROUP_LABEL = "group";

interface ReconcileArgs {
  entity: {
    metadata: {
      name: string;
      title?: string;
      description?: string;
      labels?: Record<string, string>;
    };
    spec: AutomationDefinition;
  };
  existingEntityId?: string;
  logger: { info: (msg: string) => void };
}

/**
 * Resolve the grouping label from GitOps metadata. Trims and treats a
 * blank/whitespace value as "no group".
 */
function resolveGroup(labels?: Record<string, string>): string | null {
  const raw = labels?.[GITOPS_GROUP_LABEL]?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/**
 * Reconcile an `Automation` descriptor into the `automations` table.
 * Pure of the GitOps registry shape so it can be unit-tested directly.
 * Returns the persisted automation id.
 */
export async function reconcileAutomation(
  db: Db,
  args: ReconcileArgs,
): Promise<{ entityId: string }> {
  const { entity, existingEntityId, logger } = args;
  // The spec IS the automation definition; re-validate defensively (the
  // GitOps engine already validated against specSchema, but parsing here
  // fills defaults like `mode` / `concurrency_scope`).
  const definition = AutomationDefinitionSchema.parse(entity.spec);
  const name = entity.metadata.title ?? entity.metadata.name;
  const description = entity.metadata.description ?? definition.description;
  const group = resolveGroup(entity.metadata.labels);

  if (existingEntityId) {
    const [row] = await db
      .update(automations)
      .set({
        name,
        description: description ?? null,
        group,
        definition: definition as unknown as Record<string, unknown>,
        managedBy: GITOPS_MANAGED_BY,
        updatedAt: new Date(),
      })
      .where(eq(automations.id, existingEntityId))
      .returning({ id: automations.id });
    if (row) {
      logger.info(`GitOps: updated Automation "${name}" (id: ${row.id})`);
      return { entityId: row.id };
    }
    // Row vanished (manual delete between syncs) - fall through to insert.
  }

  const [created] = await db
    .insert(automations)
    .values({
      name,
      description: description ?? null,
      group,
      status: "enabled",
      definition: definition as unknown as Record<string, unknown>,
      managedBy: GITOPS_MANAGED_BY,
    })
    .returning({ id: automations.id });
  if (!created) throw new Error("reconcileAutomation: insert returned no rows");
  logger.info(`GitOps: created Automation "${name}" (id: ${created.id})`);
  return { entityId: created.id };
}

/**
 * Delete a GitOps-managed automation. Idempotent + guarded: only deletes
 * rows still tagged `managed_by = "gitops"` so a row an operator took
 * over manually (clearing the marker) is left alone.
 */
export async function deleteAutomationEntity(
  db: Db,
  args: { entityId?: string; logger: { info: (msg: string) => void } },
): Promise<void> {
  if (!args.entityId) return;
  await db
    .delete(automations)
    .where(
      and(
        eq(automations.id, args.entityId),
        eq(automations.managedBy, GITOPS_MANAGED_BY),
      ),
    );
  args.logger.info(`GitOps: deleted Automation (id: ${args.entityId})`);
}
