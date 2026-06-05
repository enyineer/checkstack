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

/** Input for `catalog.removeSystemFromGroup`: the group + system to unassign. */
export const CatalogRemoveSystemFromGroupInputSchema = z.object({
  groupId: z.string(),
  systemId: z.string(),
});
export type CatalogRemoveSystemFromGroupInput = z.infer<
  typeof CatalogRemoveSystemFromGroupInputSchema
>;

/** Output returned once a human applies the membership change. */
export interface CatalogRemoveSystemFromGroupApplyResult {
  groupId: string;
  systemId: string;
  removed: true;
}

/**
 * `catalog.removeSystemFromGroup` - remove a system from a group.
 *
 * `effect: "mutate"` - this is a reversible UNASSIGNMENT (the system and group
 * both still exist; only the membership edge is dropped), so it is `mutate`, NOT
 * `destructive`. It auto-applies in AUTO mode and is confirm-gated in APPROVE
 * mode. Membership is part of the system surface, so authorization is the
 * `system.manage` rule (matching the contract).
 */
export function createCatalogRemoveSystemFromGroupTool(): RegisteredAiTool<
  CatalogRemoveSystemFromGroupInput,
  CatalogRemoveSystemFromGroupApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: CatalogRemoveSystemFromGroupInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<CatalogRemoveSystemFromGroupInput>> => {
    return {
      summary: `Remove system "${input.systemId}" from group "${input.groupId}".`,
      payload: input,
    };
  };

  return {
    name: "catalog.removeSystemFromGroup",
    description:
      "Remove a system from a group by their ids. This only removes the membership; the system and group are kept. Never changes membership directly; a person must approve unless the conversation is in auto mode. Find the ids with the catalog read tools first.",
    effect: "mutate",
    input: CatalogRemoveSystemFromGroupInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, catalogAccess.system.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const catalogClient = rpcClient.forPlugin(CatalogApi);
      await catalogClient.removeSystemFromGroup(input);
      return {
        groupId: input.groupId,
        systemId: input.systemId,
        removed: true,
      };
    },
  };
}
