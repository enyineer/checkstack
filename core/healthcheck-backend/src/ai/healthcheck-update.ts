import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  HealthCheckApi,
  UpdateHealthCheckConfigurationSchema,
  healthCheckAccess,
  pluginMetadata as healthcheckPluginMetadata,
  type HealthCheckConfiguration,
} from "@checkstack/healthcheck-common";
import { computeFieldDiff, type AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";
import {
  validateHealthcheckDraft,
  type HealthcheckProposeInput,
} from "./healthcheck-propose";

/**
 * Input for `healthcheck.update`: the id plus a PARTIAL configuration body. Only
 * the provided fields change; the rest are kept from the existing config. The
 * merged result is deep-validated before apply, exactly like create.
 */
export const HealthcheckUpdateInputSchema = z.object({
  id: z.string().min(1),
  body: UpdateHealthCheckConfigurationSchema,
});
export type HealthcheckUpdateInput = z.infer<typeof HealthcheckUpdateInputSchema>;

/** Output returned once a human applies the update (the updated config). */
export interface HealthcheckUpdateApplyResult {
  configuration: HealthCheckConfiguration;
}

/**
 * Merge a partial update body over the existing config into a full create-shaped
 * configuration, so it can run through the SAME deep validation as create.
 */
function mergeConfig({
  existing,
  body,
}: {
  existing: HealthCheckConfiguration;
  body: HealthcheckUpdateInput["body"];
}): HealthcheckProposeInput {
  return {
    name: body.name ?? existing.name,
    strategyId: body.strategyId ?? existing.strategyId,
    config: body.config ?? existing.config,
    intervalSeconds: body.intervalSeconds ?? existing.intervalSeconds,
    collectors: body.collectors ?? existing.collectors,
  };
}

/**
 * `healthcheck.update` - update an existing health-check configuration by id.
 *
 * `effect: "mutate"` - a non-destructive change, so it auto-applies in AUTO mode
 * and is confirm-gated in APPROVE mode, like `healthcheck.propose`. `dryRun`
 * merges the partial body over the live config and deep-validates the RESULT
 * (the same migrate-then-validate-strict path as create, including assertion
 * field/operator validation), so an invalid edit is rejected with a precise,
 * self-correcting error before apply.
 */
export function createHealthcheckUpdateTool(): RegisteredAiTool<
  HealthcheckUpdateInput,
  HealthcheckUpdateApplyResult
> {
  const dryRun = async ({
    input,
    rpcClient,
  }: {
    input: HealthcheckUpdateInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<HealthcheckUpdateInput>> => {
    const healthcheckClient = rpcClient.forPlugin(HealthCheckApi);
    const existing = await healthcheckClient.getConfiguration({ id: input.id });
    if (!existing) {
      throw new Error(
        `No health check found with id "${input.id}". List health checks first to get a valid id.`,
      );
    }
    const merged = mergeConfig({ existing, body: input.body });
    // Deep-validate the merged result (throws with structured detail if invalid,
    // including bad assertion fields/operators). Pass the id so the server
    // restores stored secrets before validating - `existing.config` is
    // redacted, so a kept `x-secret` field arrives blank and would otherwise
    // fail a required-secret check even for a name-only edit.
    const { strategy } = await validateHealthcheckDraft({
      input: merged,
      rpcClient,
      existingConfigurationId: input.id,
    });
    // before -> after diff over the updatable fields only (the existing config
    // also carries id/timestamps/paused that are not part of an update).
    const before = mergeConfig({ existing, body: {} });
    const diff = computeFieldDiff({ before, after: merged });
    return {
      summary: `Update health check "${merged.name}" (strategy "${strategy.displayName}", every ${merged.intervalSeconds}s, ${merged.collectors?.length ?? 0} collector(s)).`,
      payload: input,
      diff,
    };
  };

  return {
    name: "healthcheck.update",
    description:
      "Update an existing health-check configuration by id with a partial body (only provided fields change). The merged result is validated like create (use getCapabilitySchema for exact config fields and assertable result fields + operators). Never updates directly; a person must approve unless the conversation is in auto mode. Find the id with the health-check read tools first.",
    effect: "mutate",
    input: HealthcheckUpdateInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(
        healthcheckPluginMetadata,
        healthCheckAccess.configuration.manage,
      ),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const healthcheckClient = rpcClient.forPlugin(HealthCheckApi);
      const configuration = await healthcheckClient.updateConfiguration({
        id: input.id,
        body: input.body,
      });
      return { configuration };
    },
  };
}
