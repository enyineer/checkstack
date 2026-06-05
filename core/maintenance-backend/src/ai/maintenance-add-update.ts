import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  MaintenanceApi,
  AddMaintenanceUpdateInputSchema,
  maintenanceAccess,
  pluginMetadata,
  type MaintenanceUpdate,
  type AddMaintenanceUpdateInput,
} from "@checkstack/maintenance-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/** Output returned once a human applies the update (the posted update). */
export interface MaintenanceAddUpdateApplyResult {
  update: MaintenanceUpdate;
}

/**
 * `maintenance.addUpdate` - post a status update (message + optional status
 * change) to an existing maintenance window.
 *
 * `effect: "mutate"` - a non-destructive append, so it auto-applies in AUTO mode
 * and is confirm-gated in APPROVE mode. The underlying RPC runs through the
 * USER-SCOPED client, so handler-side authorization is enforced exactly as a
 * direct UI/RPC call.
 */
export function createMaintenanceAddUpdateTool(): RegisteredAiTool<
  AddMaintenanceUpdateInput,
  MaintenanceAddUpdateApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: AddMaintenanceUpdateInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<AddMaintenanceUpdateInput>> => {
    return {
      summary: `Post an update to maintenance "${input.maintenanceId}"${input.statusChange ? ` (status -> ${input.statusChange})` : ""}: "${input.message}".`,
      payload: input,
    };
  };

  return {
    name: "maintenance.addUpdate",
    description:
      "Post a status update (a message, optionally changing the maintenance status) to an existing maintenance window. Never posts directly; a person must approve unless the conversation is in auto mode. Find the maintenance id with the maintenance read tools first.",
    effect: "mutate",
    input: AddMaintenanceUpdateInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, maintenanceAccess.maintenance.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const maintenanceClient = rpcClient.forPlugin(MaintenanceApi);
      const update = await maintenanceClient.addUpdate(input);
      return { update };
    },
  };
}
