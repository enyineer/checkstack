import { z } from "zod";
import { SDK_EDITOR_BUNDLE_DTS } from "@checkstack/sdk/editor-bundle";
import { qualifyAccessRuleId } from "@checkstack/common";
import {
  type RpcClient,
  resolveActiveSandboxPolicy,
} from "@checkstack/backend-api";
import {
  AutomationApi,
  ScriptTestInputSchema,
  automationAccess,
  pluginMetadata as automationPluginMetadata,
} from "@checkstack/automation-common";
import {
  GetScriptContextOutputSchema,
  TestScriptInputSchema,
  TestScriptOutputSchema,
  type GetScriptContextOutput,
  type TestScriptOutput,
} from "@checkstack/ai-common";
import {
  resolveScriptContext,
  type RegisteredAiTool,
} from "@checkstack/ai-backend";

/**
 * The single access rule that authorizes BOTH automation script-context tools:
 * the automation manage rule (the same rule that gates the underlying script
 * test RPC and the automation editor UIs). These are single-plugin tools
 * (automation contexts only), so the resolver gate maps directly to the rule
 * that gates the underlying RPC - NO in-execute per-context re-check is needed
 * (unlike the former cross-plugin tools in ai-backend, which had to re-check
 * because a single tool spanned both healthcheck and automation contexts).
 */
const AUTOMATION_MANAGE_RULE = qualifyAccessRuleId(
  automationPluginMetadata,
  automationAccess.manage,
);

/** The automation-only subset of the script-context taxonomy. */
const AutomationScriptContextSchema = z.enum([
  "automation-action-script",
  "automation-action-shell",
]);

const AutomationGetScriptContextInputSchema = z.object({
  context: AutomationScriptContextSchema,
});
type AutomationGetScriptContextInput = z.infer<
  typeof AutomationGetScriptContextInputSchema
>;

const AutomationTestScriptInputSchema = TestScriptInputSchema.extend({
  context: AutomationScriptContextSchema,
});
type AutomationTestScriptInput = z.infer<
  typeof AutomationTestScriptInputSchema
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
 * `automation.getScriptContext` - return the SDK symbols / imports / type
 * signatures for an AUTOMATION script context by PURE extraction from the
 * generated SDK editor bundle (the same DTS Monaco mounts). `effect: "read"` -
 * it composes a static build-time resource and persists nothing, so it
 * auto-runs in chat.
 *
 * Authorization: a single-plugin tool gated by the automation manage rule at
 * the resolver. No in-execute re-check is needed (the tool only ever resolves
 * automation contexts; the resolver gate is the authority).
 */
export function createAutomationGetScriptContextTool(): RegisteredAiTool<
  AutomationGetScriptContextInput,
  GetScriptContextOutput
> {
  return {
    name: "automation.getScriptContext",
    description:
      "Return the SDK symbols, imports, and type signatures available to an automation action script in a given context (automation-action-script for TypeScript, automation-action-shell for shell). Use this before drafting or testing a script so you import the correct module and helper and match the runtime context shape.",
    effect: "read",
    input: AutomationGetScriptContextInputSchema,
    output: GetScriptContextOutputSchema,
    requiredAccessRules: [AUTOMATION_MANAGE_RULE],
    async execute({ input }: { input: AutomationGetScriptContextInput }) {
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

/**
 * `automation.testScript` - run a DRAFT automation action script through the
 * EXISTING fail-closed sandbox by fanning out to the automation test RPC
 * (`automationContract.testScript`) via the USER-SCOPED client passed at call
 * time, so handler-side authorization (access rules AND per-resource/team
 * scope) is enforced exactly as a direct UI/RPC call. No model call is made and
 * the spend ledger is untouched.
 *
 * `effect: "read"` - it persists NOTHING about platform config (no automation,
 * no row). It still counts toward the per-principal tool budget (enforced by
 * the chat loop around every tool call).
 *
 * Safety inherited from the RPC test path:
 *   - The fail-closed global sandbox enforces no egress / scratch FS / privilege
 *     drop; `sandboxDowngraded` surfaces a fallback so it is never silent.
 *   - This tool passes NO `secretOverrides` and NO `secretEnv`, so only
 *     `__SECRET_<NAME>__` placeholders are ever present - the model never
 *     supplies secret values.
 */
export function createAutomationTestScriptTool(): RegisteredAiTool<
  AutomationTestScriptInput,
  TestScriptOutput
> {
  return {
    name: "automation.testScript",
    description:
      "Run a drafted automation action script in the secure fail-closed sandbox and return its result, stdout/stderr, and any error - WITHOUT creating any automation. Use this to validate a draft before proposing it. Never pass real secret values; the sandbox injects placeholders only.",
    effect: "read",
    input: AutomationTestScriptInputSchema,
    output: TestScriptOutputSchema,
    requiredAccessRules: [AUTOMATION_MANAGE_RULE],
    async execute({
      input,
      rpcClient,
    }: {
      input: AutomationTestScriptInput;
      rpcClient: RpcClient;
    }) {
      const automationClient = rpcClient.forPlugin(AutomationApi);
      const kind =
        input.context === "automation-action-script" ? "typescript" : "shell";
      const sandboxDowngraded = await resolveSandboxDowngraded();

      // Map the tool input -> ScriptTestInputSchema, parsing the loose
      // `sampleContext` through the RPC's own schema (unknown keys stripped,
      // types narrowed). NEVER pass secretEnv / secretOverrides: the model
      // never supplies secret values, so only placeholders can ever appear.
      const rpcInput = ScriptTestInputSchema.parse({
        kind,
        script: input.source,
        context: input.sampleContext,
        env: input.env,
        timeoutMs: input.timeoutMs,
      });
      const raw = await automationClient.testScript(rpcInput);

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
