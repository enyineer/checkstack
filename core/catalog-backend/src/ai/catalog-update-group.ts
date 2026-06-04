import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  CatalogApi,
  catalogAccess,
  pluginMetadata,
  type Group,
} from "@checkstack/catalog-common";
import { computeFieldDiff, type AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/**
 * Input for `catalog.updateGroup`. Mirrors the contract's (module-private)
 * `UpdateGroupInputSchema`: the group id plus a PARTIAL data body. Only the
 * provided fields change; `metadata` is nullable so it can be explicitly cleared.
 */
export const CatalogUpdateGroupInputSchema = z.object({
  id: z.string(),
  data: z.object({
    name: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
});
export type CatalogUpdateGroupInput = z.infer<
  typeof CatalogUpdateGroupInputSchema
>;

/** Output returned once a human applies the update (the updated group). */
export interface CatalogUpdateGroupApplyResult {
  group: Group;
}

/**
 * `catalog.updateGroup` - update an existing group by id with a partial body.
 *
 * `effect: "mutate"` - a non-destructive change, so it auto-applies in AUTO mode
 * and is confirm-gated in APPROVE mode. `dryRun` lists groups, finds the target,
 * and returns a before -> after field diff. There is no single-group fetch on the
 * contract, so the dry-run resolves it from `getGroups()`.
 */
export function createCatalogUpdateGroupTool(): RegisteredAiTool<
  CatalogUpdateGroupInput,
  CatalogUpdateGroupApplyResult
> {
  const dryRun = async ({
    input,
    rpcClient,
  }: {
    input: CatalogUpdateGroupInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<CatalogUpdateGroupInput>> => {
    const catalogClient = rpcClient.forPlugin(CatalogApi);
    const groups = await catalogClient.getGroups();
    const group = groups.find((g) => g.id === input.id);
    if (!group) {
      throw new Error(
        `No group found with id "${input.id}". List groups first to get a valid id.`,
      );
    }
    const before = { name: group.name, metadata: group.metadata };
    const after = { ...before, ...input.data };
    const diff = computeFieldDiff({ before, after });
    return {
      summary: `Update group "${group.name}".`,
      payload: input,
      diff,
    };
  };

  return {
    name: "catalog.updateGroup",
    description:
      "Update an existing group by id with a partial body (only provided fields change). Never updates directly; a person must approve unless the conversation is in auto mode. Find the id with the catalog read tools first.",
    effect: "mutate",
    input: CatalogUpdateGroupInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, catalogAccess.group.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const catalogClient = rpcClient.forPlugin(CatalogApi);
      const group = await catalogClient.updateGroup(input);
      return { group };
    },
  };
}
