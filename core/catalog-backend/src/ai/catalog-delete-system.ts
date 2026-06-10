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

/** Input for `catalog.deleteSystem`: the system id to remove. */
export const CatalogDeleteSystemInputSchema = z.object({
  id: z.string(),
});
export type CatalogDeleteSystemInput = z.infer<
  typeof CatalogDeleteSystemInputSchema
>;

/** Output returned once a human applies the deletion. */
export interface CatalogDeleteSystemApplyResult {
  id: string;
  deleted: true;
}

/**
 * `catalog.deleteSystem` - delete a system by id.
 *
 * `effect: "destructive"` - deletion is irreversible, so it ALWAYS routes through
 * the propose/apply confirm card in BOTH permission modes (it can never
 * auto-apply). `dryRun` resolves the target system so the confirm card names
 * exactly what will be removed; `execute` (reached only via `apply`) performs the
 * delete via the contract's POSITIONAL string id. Authorization is the
 * `system.manage` rule the UI delete requires.
 */
export function createCatalogDeleteSystemTool(): RegisteredAiTool<
  CatalogDeleteSystemInput,
  CatalogDeleteSystemApplyResult
> {
  const dryRun = async ({
    input,
    rpcClient,
  }: {
    input: CatalogDeleteSystemInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<CatalogDeleteSystemInput>> => {
    const catalogClient = rpcClient.forPlugin(CatalogApi);
    const system = await catalogClient.getSystem({ systemId: input.id });
    if (!system) {
      throw new Error(
        `No system found with id "${input.id}". List systems first to get a valid id.`,
      );
    }
    return {
      summary: `Delete system "${system.name}". This is permanent and also removes its group memberships and associations.`,
      payload: { id: input.id },
    };
  };

  return {
    name: "catalog.deleteSystem",
    description:
      "Delete a system by id. DESTRUCTIVE and irreversible - it also removes the system's group memberships and associations. Never deletes directly; a person must approve the confirmation. Find the id with the catalog read tools first.",
    effect: "destructive",
    input: CatalogDeleteSystemInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, catalogAccess.system.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const catalogClient = rpcClient.forPlugin(CatalogApi);
      await catalogClient.deleteSystem({ id: input.id });
      return { id: input.id, deleted: true };
    },
  };
}
