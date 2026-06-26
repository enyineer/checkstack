import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  CatalogApi,
  catalogAccess,
  pluginMetadata,
  CreateEnvironmentSchema,
  type CreateEnvironment,
  type Environment,
} from "@checkstack/catalog-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/** Output returned once a human applies the create (the created environment). */
export interface CatalogCreateEnvironmentApplyResult {
  environment: Environment;
}

/**
 * `catalog.createEnvironment` - create an instance-wide environment (e.g.
 * `production`, `staging`) that systems can be attached to. Environments are the
 * RIGHT way to model the same system across deployment stages: a system belongs
 * to many environments and one health-check assignment runs once per
 * environment, so never clone a system per environment.
 *
 * `effect: "mutate"` - a non-destructive create, so it auto-applies in AUTO mode
 * and is confirm-gated in APPROVE mode via the propose/apply machinery. The
 * underlying RPC uses the USER-SCOPED client passed at call time, so the
 * `environment.manage` rule is enforced exactly as a direct UI/RPC call,
 * re-checked at propose AND apply time by the propose/apply service.
 */
export function createCatalogCreateEnvironmentTool(): RegisteredAiTool<
  CreateEnvironment,
  CatalogCreateEnvironmentApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: CreateEnvironment;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<CreateEnvironment>> => {
    return {
      summary: `Create environment "${input.name}"${
        input.description ? ` (${input.description})` : ""
      }.`,
      payload: input,
    };
  };

  return {
    name: "catalog.createEnvironment",
    description:
      "Create an instance-wide environment (for example production, staging, or dev) that systems can be attached to. Use environments to monitor the same system across deployment stages: a system belongs to many environments and one health-check assignment runs once per environment - do NOT create a separate system per environment. Never creates directly; a person must approve unless the conversation is in auto mode.",
    effect: "mutate",
    input: CreateEnvironmentSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, catalogAccess.environment.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const catalogClient = rpcClient.forPlugin(CatalogApi);
      const environment = await catalogClient.createEnvironment(input);
      return { environment };
    },
  };
}
