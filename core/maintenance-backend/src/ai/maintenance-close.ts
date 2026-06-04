import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  MaintenanceApi,
  maintenanceAccess,
  pluginMetadata,
  type MaintenanceWithSystems,
} from "@checkstack/maintenance-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/**
 * Input for `maintenance.close`: the maintenance id plus an optional closing
 * message. Closing sets the maintenance status to completed early.
 */
export const MaintenanceCloseInputSchema = z.object({
  id: z.string(),
  message: z.string().optional(),
});
export type MaintenanceCloseInput = z.infer<typeof MaintenanceCloseInputSchema>;

/** Output returned once a human applies the close (the closed maintenance). */
export interface MaintenanceCloseApplyResult {
  maintenance: MaintenanceWithSystems;
}

/**
 * `maintenance.close` - close a maintenance window early (sets status to
 * completed).
 *
 * `effect: "mutate"` - a non-destructive status change, so it auto-applies in
 * AUTO mode and is confirm-gated in APPROVE mode. The underlying RPC runs through
 * the USER-SCOPED client, so handler-side authorization is enforced exactly as a
 * direct UI/RPC call.
 */
export function createMaintenanceCloseTool(): RegisteredAiTool<
  MaintenanceCloseInput,
  MaintenanceCloseApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: MaintenanceCloseInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<MaintenanceCloseInput>> => {
    return {
      summary: `Close maintenance "${input.id}" early (status -> completed)${input.message ? `: "${input.message}"` : ""}.`,
      payload: input,
    };
  };

  return {
    name: "maintenance.close",
    description:
      "Close a maintenance window early by id, setting its status to completed, with an optional closing message. Never closes directly; a person must approve unless the conversation is in auto mode. Find the id with the maintenance read tools first.",
    effect: "mutate",
    input: MaintenanceCloseInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, maintenanceAccess.maintenance.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const maintenanceClient = rpcClient.forPlugin(MaintenanceApi);
      const maintenance = await maintenanceClient.closeMaintenance(input);
      return { maintenance };
    },
  };
}
