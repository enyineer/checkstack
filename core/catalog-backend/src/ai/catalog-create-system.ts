import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  CatalogApi,
  catalogAccess,
  pluginMetadata,
  type System,
} from "@checkstack/catalog-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/**
 * Input for `catalog.createSystem`. Mirrors the contract's (module-private)
 * `CreateSystemInputSchema`: a system has a required name plus optional
 * description and free-form metadata.
 */
export const CatalogCreateSystemInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CatalogCreateSystemInput = z.infer<
  typeof CatalogCreateSystemInputSchema
>;

/** Output returned once a human applies the create (the created system). */
export interface CatalogCreateSystemApplyResult {
  system: System;
}

/**
 * `catalog.createSystem` - create a new system (a service or resource) in the
 * catalog.
 *
 * `effect: "mutate"` - a non-destructive create, so it auto-applies in AUTO mode
 * and is confirm-gated in APPROVE mode via the propose/apply machinery. The
 * underlying RPC uses the USER-SCOPED client passed at call time, so handler-side
 * authorization is enforced exactly as a direct UI/RPC call. Authorization is the
 * `system.manage` rule the UI create form requires, re-checked at propose AND
 * apply time by the propose/apply service.
 */
export function createCatalogCreateSystemTool(): RegisteredAiTool<
  CatalogCreateSystemInput,
  CatalogCreateSystemApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: CatalogCreateSystemInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<CatalogCreateSystemInput>> => {
    return {
      summary: `Create system "${input.name}"${
        input.description ? ` (${input.description})` : ""
      }.`,
      payload: input,
    };
  };

  return {
    name: "catalog.createSystem",
    description:
      "Create a new system (a service or resource) in the catalog with a name and optional description and metadata. A system usually pairs 1-1 with a single health check (create and assign it with healthcheck.propose + assignToSystemId). To monitor the same system across deployment stages, attach ENVIRONMENTS (catalog.createEnvironment + catalog.setSystemEnvironments) - do NOT create a separate system per environment. Never creates directly; a person must approve unless the conversation is in auto mode.",
    effect: "mutate",
    input: CatalogCreateSystemInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, catalogAccess.system.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const catalogClient = rpcClient.forPlugin(CatalogApi);
      const system = await catalogClient.createSystem(input);
      return { system };
    },
  };
}
