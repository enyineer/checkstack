import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  MaintenanceApi,
  UpdateMaintenanceInputSchema,
  maintenanceAccess,
  pluginMetadata,
  type MaintenanceWithSystems,
} from "@checkstack/maintenance-common";
import { computeFieldDiff, type AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/**
 * Tool-local update schema. The exported `UpdateMaintenanceInputSchema` types
 * `startAt` / `endAt` as `z.date()`, but the model sends ISO strings, so we
 * `.extend` it to coerce just those two fields to `Date` while leaving every
 * other (already-correct) field as published. The exported schema is NOT mutated.
 */
export const MaintenanceUpdateInputSchema = UpdateMaintenanceInputSchema.extend({
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
});
export type MaintenanceUpdateInput = z.infer<typeof MaintenanceUpdateInputSchema>;

/** Output returned once a human applies the update (the updated maintenance). */
export interface MaintenanceUpdateApplyResult {
  maintenance: MaintenanceWithSystems;
}

/** Fields a `maintenance.update` can change - used to build the before/after diff. */
const UPDATABLE_FIELDS = [
  "title",
  "description",
  "suppressNotifications",
  "startAt",
  "endAt",
  "systemIds",
] as const;

/**
 * `maintenance.update` - change an existing maintenance window by id with a
 * partial body (only provided fields change).
 *
 * `effect: "mutate"` - a non-destructive change, so it auto-applies in AUTO mode
 * and is confirm-gated in APPROVE mode. `dryRun` fetches the live maintenance,
 * throws a clear error if it does not exist, and renders a before/after field
 * diff over the updatable subset so the confirm card shows exactly what changes.
 */
export function createMaintenanceUpdateTool(): RegisteredAiTool<
  MaintenanceUpdateInput,
  MaintenanceUpdateApplyResult
> {
  const dryRun = async ({
    input,
    rpcClient,
  }: {
    input: MaintenanceUpdateInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<MaintenanceUpdateInput>> => {
    const maintenanceClient = rpcClient.forPlugin(MaintenanceApi);
    const existing = await maintenanceClient.getMaintenance({ id: input.id });
    if (!existing) {
      throw new Error(
        `No maintenance found with id "${input.id}". List maintenances first to get a valid id.`,
      );
    }

    // before -> after diff over the updatable subset only (the fetched detail
    // also carries id/status/timestamps/updates/links that are not updatable).
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of UPDATABLE_FIELDS) {
      before[field] = existing[field];
      after[field] = field in input ? input[field] : existing[field];
    }
    const diff = computeFieldDiff({ before, after });

    return {
      summary: `Update maintenance "${existing.title}".`,
      payload: input,
      diff,
    };
  };

  return {
    name: "maintenance.update",
    description:
      "Update an existing maintenance window by id with a partial body (only provided fields change). Provide startAt/endAt as ISO 8601 timestamps if changing them. Never updates directly; a person must approve unless the conversation is in auto mode. Find the id with the maintenance read tools first.",
    effect: "mutate",
    input: MaintenanceUpdateInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, maintenanceAccess.maintenance.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const maintenanceClient = rpcClient.forPlugin(MaintenanceApi);
      const maintenance = await maintenanceClient.updateMaintenance(input);
      return { maintenance };
    },
  };
}
