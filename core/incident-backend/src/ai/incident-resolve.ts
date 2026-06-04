import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  IncidentApi,
  incidentAccess,
  pluginMetadata,
  type IncidentWithSystems,
} from "@checkstack/incident-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/** Input for `incident.resolve`: the incident id plus an optional message. */
export const IncidentResolveInputSchema = z.object({
  id: z.string(),
  message: z.string().optional(),
});
export type IncidentResolveInput = z.infer<typeof IncidentResolveInputSchema>;

/** Output returned once a human applies the resolution (the resolved incident). */
export interface IncidentResolveApplyResult {
  incident: IncidentWithSystems;
}

/**
 * `incident.resolve` - mark an incident resolved by id, optionally with a final
 * status-update message.
 *
 * `effect: "mutate"` - resolving is a non-destructive status change, so it
 * auto-applies in AUTO mode and is confirm-gated in APPROVE mode. `dryRun`
 * returns the captured payload for human review WITHOUT mutating; `execute`
 * (reached only via `apply`) resolves the incident. The underlying RPC uses the
 * USER-SCOPED client passed at call time, so handler-side authorization is
 * enforced exactly as a direct UI/RPC call.
 */
export function createIncidentResolveTool(): RegisteredAiTool<
  IncidentResolveInput,
  IncidentResolveApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: IncidentResolveInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<IncidentResolveInput>> => {
    return {
      summary: `Resolve incident ${input.id}${input.message ? ` with message "${input.message}"` : ""}.`,
      payload: input,
    };
  };

  return {
    name: "incident.resolve",
    description:
      "Mark an incident resolved by id, optionally with a final status-update message. Never resolves directly; a person must approve unless the conversation is in auto mode. Find the id with the incident read tools first.",
    effect: "mutate",
    input: IncidentResolveInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, incidentAccess.incident.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const incidentClient = rpcClient.forPlugin(IncidentApi);
      const incident = await incidentClient.resolveIncident(input);
      return { incident };
    },
  };
}
