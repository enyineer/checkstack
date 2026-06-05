import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  AutomationApi,
  UpdateAutomationInputSchema,
  automationAccess,
  pluginMetadata as automationPluginMetadata,
  type Automation,
  type UpdateAutomationInput,
} from "@checkstack/automation-common";
import {
  computeFieldDiff,
  type AiProposalPreview,
  type AiFieldDiff,
} from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/** Output returned once a human applies the update (the updated automation). */
export interface AutomationUpdateApplyResult {
  automation: Automation;
}

/** Flatten validateDefinition issues into a model-actionable message. */
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
 * `automation.update` - update an existing automation by id with a partial body.
 *
 * `effect: "mutate"` - non-destructive, so it auto-applies in AUTO mode and is
 * confirm-gated in APPROVE mode, like `automation.propose`. When the body
 * includes a new `definition`, `dryRun` runs the automation plugin's
 * `validateDefinition` (the same dry-run as create) so an invalid edit is
 * rejected with structured detail before apply.
 */
export function createAutomationUpdateTool(): RegisteredAiTool<
  UpdateAutomationInput,
  AutomationUpdateApplyResult
> {
  const dryRun = async ({
    input,
    rpcClient,
  }: {
    input: UpdateAutomationInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<UpdateAutomationInput>> => {
    const automationClient = rpcClient.forPlugin(AutomationApi);
    const existing = await automationClient.getAutomation({ id: input.id });
    if (input.definition) {
      const validation = await automationClient.validateDefinition({
        definition: input.definition,
      });
      if (!validation.valid) {
        throw new Error(
          `The updated automation definition is invalid: ${formatIssues(validation.errors)}`,
        );
      }
    }
    const name = input.name ?? existing.name;
    // before -> after diff over only the fields this update actually sets (id is
    // the selector, not a change).
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const existingRecord = existing as unknown as Record<string, unknown>;
    const inputRecord = input as unknown as Record<string, unknown>;
    const diff: AiFieldDiff[] = [];
    for (const key of Object.keys(inputRecord)) {
      if (key === "id") continue;
      before[key] = existingRecord[key];
      after[key] = inputRecord[key];
    }
    diff.push(...computeFieldDiff({ before, after }));
    return {
      summary: `Update automation "${name}".`,
      payload: input,
      diff,
    };
  };

  return {
    name: "automation.update",
    description:
      "Update an existing automation by id with a partial body (name, description, group, status, or a new definition). When a definition is provided it is validated like create. Never updates directly; a person must approve unless the conversation is in auto mode. Find the id with the automation read tools first.",
    effect: "mutate",
    input: UpdateAutomationInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(automationPluginMetadata, automationAccess.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const automationClient = rpcClient.forPlugin(AutomationApi);
      const automation = await automationClient.updateAutomation(input);
      return { automation };
    },
  };
}
