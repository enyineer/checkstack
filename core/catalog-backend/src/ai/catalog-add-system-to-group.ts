import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  CatalogApi,
  catalogAccess,
  pluginMetadata,
} from "@checkstack/catalog-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/** Input for `catalog.addSystemToGroup`: the group + system to associate. */
export const CatalogAddSystemToGroupInputSchema = z.object({
  groupId: z.string(),
  systemId: z.string(),
});
export type CatalogAddSystemToGroupInput = z.infer<
  typeof CatalogAddSystemToGroupInputSchema
>;

/** Output returned once a human applies the membership change. */
export interface CatalogAddSystemToGroupApplyResult {
  groupId: string;
  systemId: string;
  added: true;
}

/**
 * `catalog.addSystemToGroup` - add a system to a group.
 *
 * `effect: "mutate"` - a reversible membership change, so it auto-applies in AUTO
 * mode and is confirm-gated in APPROVE mode. Membership is part of the system
 * surface, so authorization is the `system.manage` rule (matching the contract).
 */
export function createCatalogAddSystemToGroupTool(): RegisteredAiTool<
  CatalogAddSystemToGroupInput,
  CatalogAddSystemToGroupApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: CatalogAddSystemToGroupInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<CatalogAddSystemToGroupInput>> => {
    return {
      summary: `Add system "${input.systemId}" to group "${input.groupId}".`,
      payload: input,
    };
  };

  return {
    name: "catalog.addSystemToGroup",
    description:
      "Add a system to a group by their ids. Never changes membership directly; a person must approve unless the conversation is in auto mode. Find the ids with the catalog read tools first.",
    effect: "mutate",
    input: CatalogAddSystemToGroupInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, catalogAccess.system.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const catalogClient = rpcClient.forPlugin(CatalogApi);
      await catalogClient.addSystemToGroup(input);
      return { groupId: input.groupId, systemId: input.systemId, added: true };
    },
  };
}
