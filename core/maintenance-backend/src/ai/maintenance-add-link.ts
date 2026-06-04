import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  MaintenanceApi,
  AddMaintenanceLinkInputSchema,
  maintenanceAccess,
  pluginMetadata,
  type MaintenanceLink,
  type AddMaintenanceLinkInput,
} from "@checkstack/maintenance-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/** Output returned once a human applies the add (the created link). */
export interface MaintenanceAddLinkApplyResult {
  link: MaintenanceLink;
}

/**
 * `maintenance.addLink` - attach a hotlink (e.g. change ticket, runbook) to an
 * existing maintenance window.
 *
 * `effect: "mutate"` - a non-destructive append, so it auto-applies in AUTO mode
 * and is confirm-gated in APPROVE mode. The underlying RPC runs through the
 * USER-SCOPED client, so handler-side authorization is enforced exactly as a
 * direct UI/RPC call.
 */
export function createMaintenanceAddLinkTool(): RegisteredAiTool<
  AddMaintenanceLinkInput,
  MaintenanceAddLinkApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: AddMaintenanceLinkInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<AddMaintenanceLinkInput>> => {
    return {
      summary: `Add link${input.label ? ` "${input.label}"` : ""} (${input.url}) to maintenance "${input.maintenanceId}".`,
      payload: input,
    };
  };

  return {
    name: "maintenance.addLink",
    description:
      "Attach a hotlink (e.g. a change ticket or runbook URL, with an optional label) to an existing maintenance window. Never adds directly; a person must approve unless the conversation is in auto mode. Find the maintenance id with the maintenance read tools first.",
    effect: "mutate",
    input: AddMaintenanceLinkInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, maintenanceAccess.maintenance.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const maintenanceClient = rpcClient.forPlugin(MaintenanceApi);
      const link = await maintenanceClient.addLink(input);
      return { link };
    },
  };
}
