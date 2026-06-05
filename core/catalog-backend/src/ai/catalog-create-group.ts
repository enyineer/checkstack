import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  CatalogApi,
  catalogAccess,
  pluginMetadata,
  type Group,
} from "@checkstack/catalog-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/**
 * Input for `catalog.createGroup`. Mirrors the contract's (module-private)
 * `CreateGroupInputSchema`: a group has a required name plus optional free-form
 * metadata.
 */
export const CatalogCreateGroupInputSchema = z.object({
  name: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CatalogCreateGroupInput = z.infer<
  typeof CatalogCreateGroupInputSchema
>;

/** Output returned once a human applies the create (the created group). */
export interface CatalogCreateGroupApplyResult {
  group: Group;
}

/**
 * `catalog.createGroup` - create a new system group in the catalog.
 *
 * `effect: "mutate"` - a non-destructive create, so it auto-applies in AUTO mode
 * and is confirm-gated in APPROVE mode. Authorization is the `group.manage` rule
 * the UI create form requires.
 */
export function createCatalogCreateGroupTool(): RegisteredAiTool<
  CatalogCreateGroupInput,
  CatalogCreateGroupApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: CatalogCreateGroupInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<CatalogCreateGroupInput>> => {
    return {
      summary: `Create group "${input.name}".`,
      payload: input,
    };
  };

  return {
    name: "catalog.createGroup",
    description:
      "Create a new system group in the catalog with a name and optional metadata. Never creates directly; a person must approve unless the conversation is in auto mode.",
    effect: "mutate",
    input: CatalogCreateGroupInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, catalogAccess.group.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const catalogClient = rpcClient.forPlugin(CatalogApi);
      const group = await catalogClient.createGroup(input);
      return { group };
    },
  };
}
