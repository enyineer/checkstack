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

/** Input for `maintenance.delete`: the maintenance id to remove. */
export const MaintenanceDeleteInputSchema = z.object({
  id: z.string(),
});
export type MaintenanceDeleteInput = z.infer<typeof MaintenanceDeleteInputSchema>;

/** Output returned once a human applies the deletion. */
export interface MaintenanceDeleteApplyResult {
  id: string;
  deleted: true;
}

/**
 * `maintenance.delete` - delete a maintenance window by id.
 *
 * `effect: "destructive"` - deletion is irreversible, so it ALWAYS routes through
 * the propose/apply confirm card in BOTH permission modes (it can never
 * auto-apply). `dryRun` resolves the target maintenance so the confirm card names
 * exactly what will be removed; `execute` (reached only via `apply`) performs the
 * delete through the USER-SCOPED client, so handler-side authorization is
 * enforced exactly as a direct UI/RPC call.
 */
export function createMaintenanceDeleteTool(): RegisteredAiTool<
  MaintenanceDeleteInput,
  MaintenanceDeleteApplyResult
> {
  const dryRun = async ({
    input,
    rpcClient,
  }: {
    input: MaintenanceDeleteInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<MaintenanceDeleteInput>> => {
    const maintenanceClient = rpcClient.forPlugin(MaintenanceApi);
    const maintenance = await maintenanceClient.getMaintenance({ id: input.id });
    if (!maintenance) {
      throw new Error(
        `No maintenance found with id "${input.id}". List maintenances first to get a valid id.`,
      );
    }
    return {
      summary: `Delete maintenance "${maintenance.title}". This is permanent and also removes its updates and links.`,
      payload: { id: input.id },
    };
  };

  return {
    name: "maintenance.delete",
    description:
      "Delete a maintenance window by id. DESTRUCTIVE and irreversible - it also removes the maintenance's updates and links. Never deletes directly; a person must approve the confirmation. Find the id with the maintenance read tools first.",
    effect: "destructive",
    input: MaintenanceDeleteInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, maintenanceAccess.maintenance.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const maintenanceClient = rpcClient.forPlugin(MaintenanceApi);
      await maintenanceClient.deleteMaintenance({ id: input.id });
      return { id: input.id, deleted: true };
    },
  };
}
