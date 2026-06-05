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

/** Input for `incident.delete`: the incident id to remove. */
export const IncidentDeleteInputSchema = z.object({
  id: z.string(),
});
export type IncidentDeleteInput = z.infer<typeof IncidentDeleteInputSchema>;

/** Output returned once a human applies the deletion. */
export interface IncidentDeleteApplyResult {
  id: string;
  deleted: true;
}

/**
 * `incident.delete` - permanently delete an incident by id.
 *
 * `effect: "destructive"` - deletion is irreversible, so it ALWAYS routes
 * through the propose/apply confirm card in BOTH permission modes (it can never
 * auto-apply). `dryRun` resolves the target so the confirm card names exactly
 * what will be removed and rejects an unknown id; `execute` (reached only via
 * `apply`) performs the delete. The underlying RPC uses the USER-SCOPED client
 * passed at call time, so handler-side authorization is enforced exactly as a
 * direct UI/RPC call.
 */
export function createIncidentDeleteTool(): RegisteredAiTool<
  IncidentDeleteInput,
  IncidentDeleteApplyResult
> {
  const dryRun = async ({
    input,
    rpcClient,
  }: {
    input: IncidentDeleteInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<IncidentDeleteInput>> => {
    const incidentClient = rpcClient.forPlugin(IncidentApi);
    const incident = await incidentClient.getIncident({ id: input.id });
    if (!incident) {
      throw new Error(
        `No incident found with id "${input.id}". List incidents first to get a valid id.`,
      );
    }
    return {
      summary: `Delete incident "${incident.title}" (severity ${incident.severity}). This is permanent and also removes its updates, links, and system associations.`,
      payload: { id: input.id },
    };
  };

  return {
    name: "incident.delete",
    description:
      "Delete an incident by id. DESTRUCTIVE and irreversible - it also removes the incident's updates, links, and system associations. Never deletes directly; a person must approve the confirmation. Find the id with the incident read tools first.",
    effect: "destructive",
    input: IncidentDeleteInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, incidentAccess.incident.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const incidentClient = rpcClient.forPlugin(IncidentApi);
      await incidentClient.deleteIncident({ id: input.id });
      return { id: input.id, deleted: true };
    },
  };
}
