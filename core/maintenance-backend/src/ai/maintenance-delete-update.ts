import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  MaintenanceApi,
  maintenanceAccess,
  pluginMetadata,
} from "@checkstack/maintenance-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/** Input for `maintenance.deleteUpdate`: the update id + its owning maintenance. */
export const MaintenanceDeleteUpdateInputSchema = z.object({
  id: z.string(),
  maintenanceId: z.string(),
});
export type MaintenanceDeleteUpdateInput = z.infer<
  typeof MaintenanceDeleteUpdateInputSchema
>;

/** Output returned once a human applies the update removal. */
export interface MaintenanceDeleteUpdateApplyResult {
  id: string;
  removed: true;
}

/**
 * `maintenance.deleteUpdate` - delete a published status update by id.
 *
 * `effect: "destructive"` - deletion is irreversible, so it ALWAYS routes
 * through the propose/apply confirm card in BOTH permission modes (it can never
 * auto-apply). `execute` (reached only via `apply`) performs the delete through
 * the USER-SCOPED client, so handler-side authorization is enforced exactly as a
 * direct UI/RPC call.
 */
export function createMaintenanceDeleteUpdateTool(): RegisteredAiTool<
  MaintenanceDeleteUpdateInput,
  MaintenanceDeleteUpdateApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: MaintenanceDeleteUpdateInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<MaintenanceDeleteUpdateInput>> => {
    return {
      summary: `Delete update "${input.id}" from maintenance ${input.maintenanceId}. This is permanent.`,
      payload: { id: input.id, maintenanceId: input.maintenanceId },
    };
  };

  return {
    name: "maintenance.deleteUpdate",
    description:
      "Delete a published status update from a maintenance window by update id and its owning maintenanceId. DESTRUCTIVE and irreversible. Never deletes directly; a person must approve the confirmation. Find the update id and maintenanceId with the maintenance read tools first.",
    effect: "destructive",
    input: MaintenanceDeleteUpdateInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, maintenanceAccess.maintenance.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const maintenanceClient = rpcClient.forPlugin(MaintenanceApi);
      await maintenanceClient.deleteUpdate({
        id: input.id,
        maintenanceId: input.maintenanceId,
      });
      return { id: input.id, removed: true };
    },
  };
}
