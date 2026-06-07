import { stringify as toYaml } from "yaml";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  AutomationApi,
  AutomationDefinitionSchema,
  AutomationGroupSchema,
  pluginMetadata as automationPluginMetadata,
  automationAccess,
  type Automation,
} from "@checkstack/automation-common";
import { z } from "zod";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";
import { collectProposeIssues } from "./automation-propose-validate";

/**
 * Input for the flagship `automation.propose` composite tool.
 *
 * The model authors a structured draft automation definition (the hard part of
 * "NL -> automation"); this tool's job is to VALIDATE that draft against the
 * live trigger/action registries (reusing the mature `validateDefinition`
 * dry-run) and return it for a human to apply. The shape reuses
 * `AutomationDefinitionSchema` so the model is constrained to a valid skeleton.
 */
export const AutomationProposeInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  group: AutomationGroupSchema.optional(),
  definition: AutomationDefinitionSchema,
  /**
   * Id of the application (service account) the automation will run as. Every
   * action authenticates as this identity, so it must hold the access rules the
   * automation's actions need, and the requesting user must be allowed to bind
   * it. Pick one from the user's bindable service accounts.
   */
  runAs: z
    .string()
    .min(1)
    .describe(
      "Application (service account) id the automation runs as. The user must be allowed to bind it.",
    ),
});

export type AutomationProposeInput = z.infer<typeof AutomationProposeInputSchema>;

/** Output returned once a human applies the proposal (the created automation). */
export interface AutomationProposeApplyResult {
  automation: Automation;
}

class AutomationProposeValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: Array<{ path: Array<string | number>; message: string }>,
  ) {
    super(message);
    this.name = "AutomationProposeValidationError";
  }
}

/**
 * The flagship composite tool: natural language -> validated draft automation
 * -> human applies (decision 6, §8). The AI NEVER silently creates an
 * automation. `dryRun` validates without mutating (reusing the automation
 * plugin's `validateDefinition`); the actual `createAutomation` happens only at
 * `apply`, behind the propose/apply token gate.
 *
 * Authorization: `requiredAccessRules` is `automation.automation.manage`, so the
 * resolver only surfaces this tool to a principal who could create an
 * automation in the UI, and the propose/apply service re-checks at apply time.
 * The underlying RPC calls go through the USER-SCOPED client passed at call time,
 * so handler-side authorization (access rules AND per-resource/team scope) is
 * enforced exactly as a direct UI/RPC call.
 */
export function createAutomationProposeTool(): RegisteredAiTool<
  AutomationProposeInput,
  AutomationProposeApplyResult
> {
  const dryRun = async ({
    input,
    rpcClient,
  }: {
    input: AutomationProposeInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<AutomationProposeInput>> => {
    const automationClient = rpcClient.forPlugin(AutomationApi);
    // Reuse the automation plugin's dry-run: structural + semantic + artifact-
    // wiring validation against the live registries, WITHOUT creating anything.
    // Run it alongside the caller-scoped propose-time checks (runAs bindability
    // + connectionId existence) that the RPC can't see, so a fabricated runAs,
    // unknown connectionId, or unwired artifact reference is all caught on the
    // review card rather than at run time.
    const [validation, proposeIssues] = await Promise.all([
      automationClient.validateDefinition({ definition: input.definition }),
      collectProposeIssues({ input, rpcClient }),
    ]);
    const errors = [...validation.errors, ...proposeIssues];
    if (errors.length > 0) {
      throw new AutomationProposeValidationError(
        "The drafted automation is invalid.",
        errors,
      );
    }

    // Render the full draft for human review: the automation-row fields
    // (name / group) plus the validated definition body. `name` from
    // `input.definition` is the definition's own name; the top-level
    // `automation` block carries the row name + grouping.
    const yaml = toYaml({
      automation: {
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        ...(input.group ? { group: input.group } : {}),
      },
      definition: input.definition,
    });

    return {
      summary: `Create automation "${input.name}" with ${input.definition.triggers.length} trigger(s) and ${input.definition.actions.length} action(s).`,
      // The validated, ready-to-apply payload captured at propose time. The
      // chat confirm card / editor seeds from this; the YAML is for display.
      payload: { ...input, yaml } as AutomationProposeInput & { yaml: string },
    };
  };

  return {
    name: "automation.propose",
    description:
      "Validate a drafted automation (triggers, conditions, actions) and return it for a human to review and apply. Never creates an automation directly — a person must approve the proposal. Use this to turn a natural-language automation request into a concrete, validated draft.",
    effect: "mutate",
    input: AutomationProposeInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(automationPluginMetadata, automationAccess.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const automationClient = rpcClient.forPlugin(AutomationApi);
      // Only reached via `apply` (the propose/apply token gate). Re-validates
      // implicitly by relying on the automation create handler's own zod check.
      const automation = await automationClient.createAutomation({
        name: input.name,
        description: input.description,
        group: input.group,
        status: "enabled",
        definition: input.definition,
        runAs: input.runAs,
      });
      return { automation };
    },
  };
}
