import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  AutomationApi,
  automationAccess,
  pluginMetadata as automationPluginMetadata,
} from "@checkstack/automation-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/** Input for `automation.delete`: the automation id to remove. */
export const AutomationDeleteInputSchema = z.object({
  id: z.string().min(1),
});
export type AutomationDeleteInput = z.infer<typeof AutomationDeleteInputSchema>;

/** Output returned once a human applies the deletion. */
export interface AutomationDeleteApplyResult {
  id: string;
  deleted: boolean;
}

/**
 * `automation.delete` - delete an automation by id.
 *
 * `effect: "destructive"` - irreversible, so it ALWAYS routes through the
 * propose/apply confirm card in BOTH permission modes. `dryRun` resolves the
 * target automation so the confirm card names exactly what will be removed;
 * `execute` (reached only via `apply`) performs the delete.
 */
export function createAutomationDeleteTool(): RegisteredAiTool<
  AutomationDeleteInput,
  AutomationDeleteApplyResult
> {
  const dryRun = async ({
    input,
    rpcClient,
  }: {
    input: AutomationDeleteInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<AutomationDeleteInput>> => {
    const automationClient = rpcClient.forPlugin(AutomationApi);
    const automation = await automationClient.getAutomation({ id: input.id });
    if (!automation) {
      throw new Error(
        `No automation found with id "${input.id}". List automations first to get a valid id.`,
      );
    }
    return {
      summary: `Delete automation "${automation.name}". This is permanent.`,
      payload: { id: input.id },
    };
  };

  return {
    name: "automation.delete",
    description:
      "Delete an automation by id. DESTRUCTIVE and irreversible. Never deletes directly; a person must approve the confirmation. Find the id with the automation read tools first.",
    effect: "destructive",
    input: AutomationDeleteInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(automationPluginMetadata, automationAccess.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const automationClient = rpcClient.forPlugin(AutomationApi);
      const result = await automationClient.deleteAutomation({ id: input.id });
      return { id: input.id, deleted: result.success };
    },
  };
}
