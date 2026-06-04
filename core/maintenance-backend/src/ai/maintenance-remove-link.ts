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

/** Input for `maintenance.removeLink`: the link id to remove. */
export const MaintenanceRemoveLinkInputSchema = z.object({
  id: z.string(),
});
export type MaintenanceRemoveLinkInput = z.infer<
  typeof MaintenanceRemoveLinkInputSchema
>;

/** Output returned once a human applies the removal. */
export interface MaintenanceRemoveLinkApplyResult {
  id: string;
  removed: true;
}

/**
 * `maintenance.removeLink` - remove a hotlink from a maintenance window by link
 * id.
 *
 * `effect: "destructive"` - removal is irreversible, so it ALWAYS routes through
 * the propose/apply confirm card in BOTH permission modes (it can never
 * auto-apply). `execute` (reached only via `apply`) performs the removal through
 * the USER-SCOPED client, so handler-side authorization is enforced exactly as a
 * direct UI/RPC call.
 */
export function createMaintenanceRemoveLinkTool(): RegisteredAiTool<
  MaintenanceRemoveLinkInput,
  MaintenanceRemoveLinkApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: MaintenanceRemoveLinkInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<MaintenanceRemoveLinkInput>> => {
    return {
      summary: `Remove link "${input.id}" from its maintenance window. This is permanent.`,
      payload: { id: input.id },
    };
  };

  return {
    name: "maintenance.removeLink",
    description:
      "Remove a hotlink from a maintenance window by link id. DESTRUCTIVE and irreversible. Never removes directly; a person must approve the confirmation. Find the link id with the maintenance read tools first.",
    effect: "destructive",
    input: MaintenanceRemoveLinkInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, maintenanceAccess.maintenance.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const maintenanceClient = rpcClient.forPlugin(MaintenanceApi);
      await maintenanceClient.removeLink({ id: input.id });
      return { id: input.id, removed: true };
    },
  };
}
