import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  IncidentApi,
  incidentAccess,
  pluginMetadata,
} from "@checkstack/incident-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/** Input for `incident.removeLink`: the link id to remove. */
export const IncidentRemoveLinkInputSchema = z.object({
  id: z.string(),
});
export type IncidentRemoveLinkInput = z.infer<
  typeof IncidentRemoveLinkInputSchema
>;

/** Output returned once a human applies the link removal. */
export interface IncidentRemoveLinkApplyResult {
  id: string;
  removed: true;
}

/**
 * `incident.removeLink` - detach a hotlink from an incident by link id.
 *
 * `effect: "destructive"` - removing a link is irreversible, so it ALWAYS routes
 * through the propose/apply confirm card in BOTH permission modes (it can never
 * auto-apply). `dryRun` returns the captured payload for human review WITHOUT
 * mutating; `execute` (reached only via `apply`) removes the link. The
 * underlying RPC uses the USER-SCOPED client passed at call time, so
 * handler-side authorization is enforced exactly as a direct UI/RPC call.
 */
export function createIncidentRemoveLinkTool(): RegisteredAiTool<
  IncidentRemoveLinkInput,
  IncidentRemoveLinkApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: IncidentRemoveLinkInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<IncidentRemoveLinkInput>> => {
    return {
      summary: `Remove link ${input.id} from its incident. This is permanent.`,
      payload: { id: input.id },
    };
  };

  return {
    name: "incident.removeLink",
    description:
      "Remove a hotlink from an incident by link id. DESTRUCTIVE and irreversible. Never removes directly; a person must approve the confirmation. Find the link id by reading the incident's details first.",
    effect: "destructive",
    input: IncidentRemoveLinkInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, incidentAccess.incident.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const incidentClient = rpcClient.forPlugin(IncidentApi);
      await incidentClient.removeLink({ id: input.id });
      return { id: input.id, removed: true };
    },
  };
}
