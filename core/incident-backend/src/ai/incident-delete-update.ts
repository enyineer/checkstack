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

/** Input for `incident.deleteUpdate`: the update id + its owning incident. */
export const IncidentDeleteUpdateInputSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
});
export type IncidentDeleteUpdateInput = z.infer<
  typeof IncidentDeleteUpdateInputSchema
>;

/** Output returned once a human applies the update removal. */
export interface IncidentDeleteUpdateApplyResult {
  id: string;
  removed: true;
}

/**
 * `incident.deleteUpdate` - delete a published status update by id.
 *
 * `effect: "destructive"` - deleting an update is irreversible, so it ALWAYS
 * routes through the propose/apply confirm card in BOTH permission modes (it can
 * never auto-apply). `dryRun` returns the captured payload for human review
 * WITHOUT mutating; `execute` (reached only via `apply`) deletes the update. The
 * underlying RPC uses the USER-SCOPED client passed at call time, so
 * handler-side authorization is enforced exactly as a direct UI/RPC call.
 */
export function createIncidentDeleteUpdateTool(): RegisteredAiTool<
  IncidentDeleteUpdateInput,
  IncidentDeleteUpdateApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: IncidentDeleteUpdateInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<IncidentDeleteUpdateInput>> => {
    return {
      summary: `Delete update ${input.id} from incident ${input.incidentId}. This is permanent.`,
      payload: { id: input.id, incidentId: input.incidentId },
    };
  };

  return {
    name: "incident.deleteUpdate",
    description:
      "Delete a published status update from an incident by update id and its owning incidentId. DESTRUCTIVE and irreversible. Never deletes directly; a person must approve the confirmation. Find the update id and incidentId by reading the incident's details first.",
    effect: "destructive",
    input: IncidentDeleteUpdateInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, incidentAccess.incident.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const incidentClient = rpcClient.forPlugin(IncidentApi);
      await incidentClient.deleteUpdate({
        id: input.id,
        incidentId: input.incidentId,
      });
      return { id: input.id, removed: true };
    },
  };
}
