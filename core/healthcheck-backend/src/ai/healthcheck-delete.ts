import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  HealthCheckApi,
  healthCheckAccess,
  pluginMetadata as healthcheckPluginMetadata,
} from "@checkstack/healthcheck-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/** Input for `healthcheck.delete`: the configuration id to remove. */
export const HealthcheckDeleteInputSchema = z.object({
  id: z.string().min(1),
});
export type HealthcheckDeleteInput = z.infer<typeof HealthcheckDeleteInputSchema>;

/** Output returned once a human applies the deletion. */
export interface HealthcheckDeleteApplyResult {
  id: string;
  deleted: true;
}

/**
 * `healthcheck.delete` - delete a health-check configuration by id.
 *
 * `effect: "destructive"` - deletion is irreversible, so it ALWAYS routes
 * through the propose/apply confirm card in BOTH permission modes (it can never
 * auto-apply). `dryRun` resolves the target config so the confirm card names
 * exactly what will be removed; `execute` (reached only via `apply`) performs
 * the delete. Authorization is the same `configuration.manage` rule the UI
 * delete requires, re-checked at propose AND apply time by the propose/apply
 * service. The underlying RPC calls use the USER-SCOPED client passed at call
 * time, so handler-side authorization (access rules AND per-resource/team
 * scoping) is enforced exactly as a direct UI/RPC call.
 */
export function createHealthcheckDeleteTool(): RegisteredAiTool<
  HealthcheckDeleteInput,
  HealthcheckDeleteApplyResult
> {
  const dryRun = async ({
    input,
    rpcClient,
  }: {
    input: HealthcheckDeleteInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<HealthcheckDeleteInput>> => {
    const healthcheckClient = rpcClient.forPlugin(HealthCheckApi);
    const config = await healthcheckClient.getConfiguration({ id: input.id });
    if (!config) {
      throw new Error(
        `No health check found with id "${input.id}". List health checks first to get a valid id.`,
      );
    }
    return {
      summary: `Delete health check "${config.name}" (strategy ${config.strategyId}). This is permanent and also removes its system assignments.`,
      payload: { id: input.id },
    };
  };

  return {
    name: "healthcheck.delete",
    description:
      "Delete a health-check configuration by id. DESTRUCTIVE and irreversible - it also removes the check's system assignments. Never deletes directly; a person must approve the confirmation. Find the id with the health-check read tools first.",
    effect: "destructive",
    input: HealthcheckDeleteInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(
        healthcheckPluginMetadata,
        healthCheckAccess.configuration.manage,
      ),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const healthcheckClient = rpcClient.forPlugin(HealthCheckApi);
      await healthcheckClient.deleteConfiguration(input.id);
      return { id: input.id, deleted: true };
    },
  };
}
