import { stringify as toYaml } from "yaml";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  HealthCheckApi,
  CreateHealthCheckConfigurationSchema,
  healthCheckAccess,
  pluginMetadata as healthcheckPluginMetadata,
  type HealthCheckConfiguration,
  type HealthCheckStrategyDto,
  type CollectorDto,
} from "@checkstack/healthcheck-common";
import { z } from "zod";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";
import { validateCollectorAssertions } from "./assertion-validation";

/**
 * Input for the `healthcheck.propose` composite tool (plan OQ-6, Phase 5) - the
 * mirror of the flagship `automation.propose`. The model authors a structured
 * draft health-check configuration (the hard part of "NL -> health check");
 * this tool VALIDATES that draft against the live strategy/collector registries
 * via the published `validateConfiguration` RPC (the SAME deep migrate-then-
 * validate-strict path the create / gitops-apply path uses) and returns it for
 * a human to apply via the propose/apply gate. The shape reuses
 * `CreateHealthCheckConfigurationSchema` so the model is constrained to a valid
 * create skeleton (name, strategyId, config, intervalSeconds, collectors).
 */
export const HealthcheckProposeInputSchema =
  CreateHealthCheckConfigurationSchema;

export type HealthcheckProposeInput = z.infer<
  typeof HealthcheckProposeInputSchema
>;

/** Output returned once a human applies the proposal (the created config). */
export interface HealthcheckProposeApplyResult {
  configuration: HealthCheckConfiguration;
}

class HealthcheckProposeValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: Array<{ path: Array<string | number>; message: string }>,
  ) {
    super(message);
    this.name = "HealthcheckProposeValidationError";
  }
}

/**
 * Flatten structured validation issues into a single, model-actionable string.
 * The dry-run error surfaces to the model as plain text (a tool error), so the
 * detail must live IN the message - not just the `issues` array - for the model
 * to self-correct.
 */
function formatIssues(
  issues: Array<{ path: Array<string | number>; message: string }>,
): string {
  return issues
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.join(".")}: ${issue.message}`
        : issue.message,
    )
    .join("; ");
}

/**
 * Appended to every health-check propose summary + the tool description: a newly
 * created health check does NOT execute until it is assigned to a system, which
 * the model must tell the operator (it cannot assign automatically yet).
 */
const SYSTEM_ASSIGNMENT_HINT =
  "A new health check does not run until it is assigned to a system - after it is applied, tell the operator they must assign it to a system (Health Checks -> the check -> assign to a system) for it to start running.";

/**
 * Validate a drafted health-check configuration via the health-check plugin's
 * `validateConfiguration` RPC - the SAME deep migrate-then-validate-strict path
 * the create / gitops-apply path uses, so propose-time errors are identical to
 * apply-time errors (a wrong config type or unknown key now surfaces at propose
 * time, not just at apply). Throws a {@link HealthcheckProposeValidationError}
 * carrying every structured issue when the draft is invalid; on success
 * resolves the strategy + collector DTOs (via the published introspection RPCs)
 * so the caller can render a precise confirm card with human-readable names.
 */
export async function validateHealthcheckDraft({
  input,
  rpcClient,
}: {
  input: HealthcheckProposeInput;
  rpcClient: RpcClient;
}): Promise<{ strategy: HealthCheckStrategyDto; collectors: CollectorDto[] }> {
  const healthcheckClient = rpcClient.forPlugin(HealthCheckApi);

  // Deep validation authority: identical to apply-time / gitops-apply.
  const validation = await healthcheckClient.validateConfiguration({
    name: input.name,
    strategyId: input.strategyId,
    config: input.config,
    intervalSeconds: input.intervalSeconds,
    collectors: input.collectors,
  });
  if (!validation.valid) {
    throw new HealthcheckProposeValidationError(
      `The drafted health check is invalid: ${formatIssues(validation.errors)}`,
      validation.errors,
    );
  }

  // Valid: resolve human-readable DTOs for the confirm card. The strategy is
  // guaranteed to exist (validation passed), so a missing DTO would be a
  // registry/introspection mismatch - fall back to the raw id rather than
  // failing the (already-valid) proposal.
  const strategies = await healthcheckClient.getStrategies();
  const strategy: HealthCheckStrategyDto = strategies.find(
    (s) => s.id === input.strategyId,
  ) ?? {
    id: input.strategyId,
    displayName: input.strategyId,
    category: "other",
    configSchema: {},
  };

  const availableCollectors = input.collectors?.length
    ? await healthcheckClient.getCollectors({ strategyId: input.strategyId })
    : [];
  const resolvedCollectors: CollectorDto[] = [];
  for (const entry of input.collectors ?? []) {
    const collector = availableCollectors.find(
      (c) => c.id === entry.collectorId,
    );
    if (collector) resolvedCollectors.push(collector);
  }

  // Assertion field/operator are free-form strings that `validateConfiguration`
  // does not check, so an assertion with a bogus field/operator would save and
  // then render as empty dropdowns in the editor. Validate them against each
  // collector's RESULT schema + the canonical operator vocabulary so the model
  // gets a precise, self-correcting error instead.
  const resultSchemasById = new Map<string, Record<string, unknown>>();
  for (const collector of availableCollectors) {
    resultSchemasById.set(collector.id, collector.resultSchema);
  }
  const assertionIssues = validateCollectorAssertions({
    collectors: input.collectors,
    resultSchemasById,
  });
  if (assertionIssues.length > 0) {
    throw new HealthcheckProposeValidationError(
      `The drafted health check has invalid assertions: ${formatIssues(assertionIssues)}`,
      assertionIssues,
    );
  }

  return { strategy, collectors: resolvedCollectors };
}

/**
 * Pull the script source out of a collector config entry, if any. Inline-script
 * (TS) and shell `script` collectors carry their source under `script` or
 * `source`; we surface it on the confirm card so the human reviewing the
 * proposal sees exactly what code would run. Returns undefined for non-script
 * collectors.
 */
export function extractCollectorScriptSource(
  config: Record<string, unknown>,
): string | undefined {
  const candidate = config.script ?? config.source;
  return typeof candidate === "string" ? candidate : undefined;
}

/**
 * `healthcheck.propose` - the mirror of `automation.propose` (plan OQ-6,
 * Phase 5): natural language -> validated draft health check -> human applies.
 * The AI NEVER silently creates a health check. `dryRun` validates the draft
 * against the live registries WITHOUT mutating; the actual `createConfiguration`
 * happens only at `apply`, behind the propose/apply token gate.
 *
 * `effect: "mutate"` - creating a health-check configuration is a
 * non-destructive create, so it auto-applies in AUTO mode and is confirm-gated
 * in APPROVE mode via the Phase 4 permission machinery, exactly like
 * `automation.propose`. It is NOT `destructive`.
 *
 * Authorization: a SINGLE `requiredAccessRules` of `healthcheck.healthcheck.manage`
 * (one rule, so the framework's AND-gate is correct - the same privilege the UI
 * create form requires), and the propose/apply service re-checks `isAllowed` at
 * BOTH propose and apply time. The underlying RPC calls use the USER-SCOPED
 * client passed at call time, so handler-side authorization (access rules AND
 * per-resource/team scoping) is enforced exactly as a direct UI/RPC call; the
 * resolver gate + the propose/apply re-check are the additional authorization
 * authority for this composite tool, identical to `automation.propose`.
 */
export function createHealthcheckProposeTool(): RegisteredAiTool<
  HealthcheckProposeInput,
  HealthcheckProposeApplyResult
> {
  const dryRun = async ({
    input,
    rpcClient,
  }: {
    input: HealthcheckProposeInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<HealthcheckProposeInput>> => {
    // Validate the draft against the live strategy/collector registries WITHOUT
    // creating anything (the same registries the UI pickers read).
    const { strategy, collectors } = await validateHealthcheckDraft({
      input,
      rpcClient,
    });

    const scriptCollectors = (input.collectors ?? []).filter((entry) =>
      extractCollectorScriptSource(entry.config),
    );

    // Render the full draft for human review: the configuration fields plus the
    // resolved strategy/collector names and any script source.
    const yaml = toYaml({
      healthCheck: {
        name: input.name,
        strategy: strategy.displayName,
        strategyId: input.strategyId,
        intervalSeconds: input.intervalSeconds,
        config: input.config,
        ...(input.collectors?.length
          ? {
              collectors: input.collectors.map((entry) => {
                const match = collectors.find(
                  (c) => c.id === entry.collectorId,
                );
                return {
                  collector: match?.displayName ?? entry.collectorId,
                  collectorId: entry.collectorId,
                  config: entry.config,
                  ...(entry.assertions?.length
                    ? { assertions: entry.assertions }
                    : {}),
                };
              }),
            }
          : {}),
      },
    });

    const collectorCount = input.collectors?.length ?? 0;
    const scriptNote =
      scriptCollectors.length > 0
        ? ` (includes ${scriptCollectors.length} script collector${scriptCollectors.length === 1 ? "" : "s"})`
        : "";
    const summary = `Create health check "${input.name}" using strategy "${strategy.displayName}" with ${collectorCount} collector(s), running every ${input.intervalSeconds}s${scriptNote}. ${SYSTEM_ASSIGNMENT_HINT}`;

    return {
      summary,
      // The validated, ready-to-apply payload captured at propose time. The
      // chat confirm card / editor seeds from this; the YAML is for display.
      payload: { ...input, yaml } as HealthcheckProposeInput & { yaml: string },
    };
  };

  return {
    name: "healthcheck.propose",
    description:
      "Validate a drafted health check (strategy, collectors, interval, and any inline script source) and return it for a human to review and apply. Never creates a health check directly - a person must approve the proposal. Use this to turn a natural-language health-check request (including a script health check) into a concrete, validated draft after testing the script with testScript. If you do not know what an endpoint returns, call probeUrl first to inspect its status code and body, then assert on the real response. Use getCapabilitySchema to get exact collector config fields AND the assertable result fields + valid operators before drafting assertions (assertion field must be a result-schema field like statusCode, operator must be a full word like equals/greaterThan, never an abbreviation). Note: a newly created health check does not run until the operator assigns it to a system.",
    effect: "mutate",
    input: HealthcheckProposeInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(
        healthcheckPluginMetadata,
        healthCheckAccess.configuration.manage,
      ),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      // Only reached via `apply` (the propose/apply token gate). The create
      // handler runs its own zod + registry validation; this re-validates the
      // server-stored payload against the input schema is already done by the
      // propose/apply service before we get here.
      const healthcheckClient = rpcClient.forPlugin(HealthCheckApi);
      const configuration = await healthcheckClient.createConfiguration({
        name: input.name,
        strategyId: input.strategyId,
        config: input.config,
        intervalSeconds: input.intervalSeconds,
        collectors: input.collectors,
      });
      return { configuration };
    },
  };
}
