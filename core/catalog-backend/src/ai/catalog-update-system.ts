import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  CatalogApi,
  catalogAccess,
  pluginMetadata,
  type System,
} from "@checkstack/catalog-common";
import { computeFieldDiff, type AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/**
 * Input for `catalog.updateSystem`. Mirrors the contract's (module-private)
 * `UpdateSystemInputSchema`: the system id plus a PARTIAL data body. Only the
 * provided fields change; `description` / `metadata` are nullable so they can be
 * explicitly cleared.
 */
export const CatalogUpdateSystemInputSchema = z.object({
  id: z.string(),
  data: z.object({
    name: z.string().optional().describe("New display name for the system."),
    description: z
      .string()
      .nullable()
      .optional()
      .describe("New description; pass null to clear it."),
    metadata: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional()
      .describe(
        "REPLACES the system's free-form key/value custom fields. Each key becomes available in health-check config templates as `{{ system.metadata.<key> }}` (e.g. `{{ system.metadata.baseUrl }}`). Pass the FULL desired set (it is not merged); pass null or {} to clear all fields. ONLY set keys the user explicitly asks to store - do NOT invent keys and do NOT use this to tag/label/group systems (use Groups and Environments). Omit this field to leave the existing fields unchanged.",
      ),
  }),
});
export type CatalogUpdateSystemInput = z.infer<
  typeof CatalogUpdateSystemInputSchema
>;

/** Output returned once a human applies the update (the updated system). */
export interface CatalogUpdateSystemApplyResult {
  system: System;
}

/**
 * `catalog.updateSystem` - update an existing system by id with a partial body.
 *
 * `effect: "mutate"` - a non-destructive change, so it auto-applies in AUTO mode
 * and is confirm-gated in APPROVE mode. `dryRun` fetches the live system, merges
 * the partial body, and returns a before -> after field diff so the confirm card
 * shows exactly what changes.
 */
export function createCatalogUpdateSystemTool(): RegisteredAiTool<
  CatalogUpdateSystemInput,
  CatalogUpdateSystemApplyResult
> {
  const dryRun = async ({
    input,
    rpcClient,
  }: {
    input: CatalogUpdateSystemInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<CatalogUpdateSystemInput>> => {
    const catalogClient = rpcClient.forPlugin(CatalogApi);
    const system = await catalogClient.getSystem({ systemId: input.id });
    if (!system) {
      throw new Error(
        `No system found with id "${input.id}". List systems first to get a valid id.`,
      );
    }
    const before = {
      name: system.name,
      description: system.description,
      metadata: system.metadata,
    };
    const after = { ...before, ...input.data };
    const diff = computeFieldDiff({ before, after });
    return {
      summary: `Update system "${system.name}".`,
      payload: input,
      diff,
    };
  };

  return {
    name: "catalog.updateSystem",
    description:
      "Update an existing system by id with a partial body (only provided fields change). Never updates directly; a person must approve unless the conversation is in auto mode. Find the id with the catalog read tools first.",
    effect: "mutate",
    input: CatalogUpdateSystemInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, catalogAccess.system.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const catalogClient = rpcClient.forPlugin(CatalogApi);
      const system = await catalogClient.updateSystem(input);
      return { system };
    },
  };
}
