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

/** Input for `catalog.deleteGroup`: the group id to remove. */
export const CatalogDeleteGroupInputSchema = z.object({
  id: z.string(),
});
export type CatalogDeleteGroupInput = z.infer<
  typeof CatalogDeleteGroupInputSchema
>;

/** Output returned once a human applies the deletion. */
export interface CatalogDeleteGroupApplyResult {
  id: string;
  deleted: true;
}

/**
 * `catalog.deleteGroup` - delete a group by id.
 *
 * `effect: "destructive"` - deletion is irreversible, so it ALWAYS routes through
 * the propose/apply confirm card in BOTH permission modes. `dryRun` resolves the
 * target group (via `getGroups()`, since there is no single-group fetch) so the
 * confirm card names exactly what will be removed; `execute` (reached only via
 * `apply`) performs the delete via the contract's POSITIONAL string id.
 */
export function createCatalogDeleteGroupTool(): RegisteredAiTool<
  CatalogDeleteGroupInput,
  CatalogDeleteGroupApplyResult
> {
  const dryRun = async ({
    input,
    rpcClient,
  }: {
    input: CatalogDeleteGroupInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<CatalogDeleteGroupInput>> => {
    const catalogClient = rpcClient.forPlugin(CatalogApi);
    const groups = await catalogClient.getGroups();
    const group = groups.find((g) => g.id === input.id);
    if (!group) {
      throw new Error(
        `No group found with id "${input.id}". List groups first to get a valid id.`,
      );
    }
    return {
      summary: `Delete group "${group.name}". This is permanent and also removes its system memberships.`,
      payload: { id: input.id },
    };
  };

  return {
    name: "catalog.deleteGroup",
    description:
      "Delete a group by id. DESTRUCTIVE and irreversible - it also removes the group's system memberships. Never deletes directly; a person must approve the confirmation. Find the id with the catalog read tools first.",
    effect: "destructive",
    input: CatalogDeleteGroupInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, catalogAccess.group.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const catalogClient = rpcClient.forPlugin(CatalogApi);
      await catalogClient.deleteGroup({ id: input.id });
      return { id: input.id, deleted: true };
    },
  };
}
