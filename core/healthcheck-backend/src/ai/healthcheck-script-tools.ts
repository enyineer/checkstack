import { SDK_EDITOR_BUNDLE_DTS } from "@checkstack/sdk/editor-bundle";
import { qualifyAccessRuleId } from "@checkstack/common";
import { resolveActiveSandboxPolicy } from "@checkstack/backend-api";
import {
  HealthCheckApi,
  CollectorScriptTestInputSchema,
  healthCheckAccess,
  pluginMetadata as healthcheckPluginMetadata,
} from "@checkstack/healthcheck-common";
import {
  GetScriptContextOutputSchema,
  TestScriptInputSchema,
  TestScriptOutputSchema,
  type GetScriptContextOutput,
  type TestScriptOutput,
} from "@checkstack/ai-common";
import { resolveScriptContext } from "@checkstack/ai-backend";
import type { RegisteredAiTool } from "@checkstack/ai-backend";
import { z } from "zod";

/**
 * The healthcheck script-context rule that gates BOTH script tools. These are
 * single-context (healthcheck-only) tools, so the resolver gate by the
 * healthcheck configuration-manage rule is the authority - there is no
 * cross-context surface, so no in-execute context assertion is needed (the old
 * cross-context tools needed one because they fanned out to multiple plugins;
 * these only ever handle healthcheck contexts).
 */
const HEALTHCHECK_MANAGE_RULE = qualifyAccessRuleId(
  healthcheckPluginMetadata,
  healthCheckAccess.configuration.manage,
);

/** The two healthcheck script contexts this plugin's tools handle. */
const HealthcheckScriptContextSchema = z.enum([
  "healthcheck-script",
  "healthcheck-shell",
]);

export const HealthcheckGetScriptContextInputSchema = z.object({
  context: HealthcheckScriptContextSchema,
});
export type HealthcheckGetScriptContextInput = z.infer<
  typeof HealthcheckGetScriptContextInputSchema
>;

/**
 * `healthcheck.getScriptContext` - return the SDK symbols / imports / type
 * signatures for a HEALTHCHECK script context by PURE extraction from the
 * generated SDK editor bundle (the same DTS Monaco mounts). `effect: "read"` -
 * it composes a static build-time resource and persists nothing, so it
 * auto-runs in chat.
 *
 * This is a single-context (healthcheck-only) tool, so it is gated directly by
 * the healthcheck configuration-manage rule at the resolver - no in-execute
 * context assertion is needed.
 */
export function createHealthcheckGetScriptContextTool(): RegisteredAiTool<
  HealthcheckGetScriptContextInput,
  GetScriptContextOutput
> {
  return {
    name: "healthcheck.getScriptContext",
    description:
      "Return the SDK symbols, imports, and type signatures available to a health-check script in a given context (healthcheck-script, healthcheck-shell). Use this before drafting or testing a script so you import the correct module and helper and match the runtime context shape.",
    effect: "read",
    input: HealthcheckGetScriptContextInputSchema,
    output: GetScriptContextOutputSchema,
    requiredAccessRules: [HEALTHCHECK_MANAGE_RULE],
    async execute({ input }) {
      const resolved = resolveScriptContext({
        context: input.context,
        bundle: SDK_EDITOR_BUNDLE_DTS,
      });
      return {
        context: resolved.context,
        language: resolved.language,
        sdkModule: resolved.sdkModule,
        helper: resolved.helper,
        declarations: resolved.declarations,
        shellEnv: resolved.shellEnv ? [...resolved.shellEnv] : undefined,
        starterExample: resolved.starterExample,
        allowsManagedPackages: resolved.allowsManagedPackages,
      };
    },
  };
}

export const HealthcheckTestScriptInputSchema = TestScriptInputSchema.extend({
  context: HealthcheckScriptContextSchema,
});
export type HealthcheckTestScriptInput = z.infer<
  typeof HealthcheckTestScriptInputSchema
>;

/**
 * Resolve whether the active GLOBAL sandbox policy fell back to the fail-closed
 * profile (no provider, or the provider threw). Surfaced as `sandboxDowngraded`
 * so the model/operator NEVER gets a silent downgrade. Pure read of the same
 * global policy the runners themselves resolve, so it is pod-consistent; any
 * read failure conservatively reports a downgrade rather than masking one.
 */
async function resolveSandboxDowngraded(): Promise<boolean> {
  try {
    const { failedClosed } = await resolveActiveSandboxPolicy();
    return failedClosed;
  } catch {
    return true;
  }
}

/**
 * `healthcheck.testScript` - run a DRAFT health-check script through the
 * EXISTING fail-closed sandbox by calling `healthCheckContract.testCollectorScript`
 * via the USER-SCOPED client passed at call time, so handler-side authorization
 * is enforced exactly as a direct UI/RPC call. No model call is made, so the
 * spend ledger is untouched.
 *
 * `effect: "read"` - it persists NOTHING about platform config (no health
 * check, no row). It still counts toward the per-principal tool budget
 * (enforced by the chat loop around every tool call).
 *
 * This is a single-context (healthcheck-only) tool, gated directly by the
 * healthcheck configuration-manage rule at the resolver - no in-execute context
 * assertion is needed.
 *
 * Safety inherited from the RPC test path:
 *   - The fail-closed global sandbox enforces no egress / scratch FS / privilege
 *     drop; `sandboxDowngraded` surfaces a fallback so it is never silent.
 *   - This tool passes NO `secretOverrides` and NO `secretEnv`, so only
 *     `__SECRET_<NAME>__` placeholders are ever present - the model never
 *     supplies secret values.
 *   - `timeoutMs` is capped at 30s in the input (stricter than the RPC's 300s).
 */
export function createHealthcheckTestScriptTool(): RegisteredAiTool<
  HealthcheckTestScriptInput,
  TestScriptOutput
> {
  return {
    name: "healthcheck.testScript",
    description:
      "Run a drafted health-check script in the secure fail-closed sandbox and return its result, stdout/stderr, and any error - WITHOUT creating any health check. Use this to validate a draft before proposing it. Never pass real secret values; the sandbox injects placeholders only.",
    effect: "read",
    input: HealthcheckTestScriptInputSchema,
    output: TestScriptOutputSchema,
    requiredAccessRules: [HEALTHCHECK_MANAGE_RULE],
    async execute({ input, rpcClient }) {
      const healthCheckClient = rpcClient.forPlugin(HealthCheckApi);
      const kind =
        input.context === "healthcheck-script" ? "typescript" : "shell";
      const sandboxDowngraded = await resolveSandboxDowngraded();

      // Map the tool input -> CollectorScriptTestInputSchema, parsing the loose
      // `sampleContext` through the RPC's own schema (unknown keys are stripped,
      // types narrowed). NEVER pass secretEnv / secretOverrides: the model never
      // supplies secret values, so only placeholders can ever appear in the run.
      const rpcInput = CollectorScriptTestInputSchema.parse({
        kind,
        script: input.source,
        config: input.config,
        env: input.env,
        runContext: input.sampleContext,
        timeoutMs: input.timeoutMs,
      });
      const raw = await healthCheckClient.testCollectorScript(rpcInput);

      return {
        result: raw.result,
        stdout: raw.stdout,
        stderr: raw.stderr,
        exitCode: raw.exitCode,
        durationMs: raw.durationMs,
        timedOut: raw.timedOut,
        error: raw.error,
        sandboxDowngraded,
      };
    },
  };
}
