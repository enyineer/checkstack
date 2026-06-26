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

/**
 * Input for `catalog.setSystemEnvironments`: the DESIRED set of environments a
 * system belongs to. Mirrors the contract's `setSystemEnvironments` input (a
 * desired-set diff: adds missing links, prunes stale ones).
 */
export const CatalogSetSystemEnvironmentsInputSchema = z.object({
  systemId: z.string(),
  environmentIds: z.array(z.string()),
});
export type CatalogSetSystemEnvironmentsInput = z.infer<
  typeof CatalogSetSystemEnvironmentsInputSchema
>;

/** Output returned once a human applies the change. */
export interface CatalogSetSystemEnvironmentsApplyResult {
  success: boolean;
}

/**
 * `catalog.setSystemEnvironments` - set which environments a system belongs to
 * (desired-set: adds missing links, prunes stale ones). This is how a system is
 * placed into production/staging/dev so its single health-check assignment fans
 * out one run per environment.
 *
 * `effect: "mutate"`. Authorization is scoped on the TARGET SYSTEM
 * (`catalog.system` manage) plus the `environment.manage` feature gate, enforced
 * via the USER-SCOPED client and re-checked at propose AND apply time.
 */
export function createCatalogSetSystemEnvironmentsTool(): RegisteredAiTool<
  CatalogSetSystemEnvironmentsInput,
  CatalogSetSystemEnvironmentsApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: CatalogSetSystemEnvironmentsInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<CatalogSetSystemEnvironmentsInput>> => {
    const count = input.environmentIds.length;
    return {
      summary: `Set this system to belong to ${count} environment${
        count === 1 ? "" : "s"
      } (replaces the current set).`,
      payload: input,
    };
  };

  return {
    name: "catalog.setSystemEnvironments",
    description:
      "Set the exact set of environments a system belongs to (adds missing links and removes ones not listed). Use this to put a system into production/staging/dev so its health-check assignment runs once per environment. Resolve environment ids with catalog.listEnvironments (create them with catalog.createEnvironment first). Never changes directly; a person must approve unless the conversation is in auto mode.",
    effect: "mutate",
    input: CatalogSetSystemEnvironmentsInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, catalogAccess.environment.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const catalogClient = rpcClient.forPlugin(CatalogApi);
      const result = await catalogClient.setSystemEnvironments(input);
      return { success: result.success };
    },
  };
}
