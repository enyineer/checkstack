import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  IncidentApi,
  incidentAccess,
  pluginMetadata,
  AddIncidentUpdateInputSchema,
  type AddIncidentUpdateInput,
  type IncidentUpdate,
} from "@checkstack/incident-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/** Output returned once a human applies the update post (the new update). */
export interface IncidentAddUpdateApplyResult {
  update: IncidentUpdate;
}

/**
 * `incident.addUpdate` - post a status update (timeline entry) to an incident,
 * optionally changing its status.
 *
 * `effect: "mutate"` - appending an update is a non-destructive change, so it
 * auto-applies in AUTO mode and is confirm-gated in APPROVE mode. `dryRun`
 * returns the captured payload for human review WITHOUT mutating; `execute`
 * (reached only via `apply`) posts the update. The underlying RPC uses the
 * USER-SCOPED client passed at call time, so handler-side authorization is
 * enforced exactly as a direct UI/RPC call.
 */
export function createIncidentAddUpdateTool(): RegisteredAiTool<
  AddIncidentUpdateInput,
  IncidentAddUpdateApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: AddIncidentUpdateInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<AddIncidentUpdateInput>> => {
    const statusNote = input.statusChange
      ? ` and set status to "${input.statusChange}"`
      : "";
    return {
      summary: `Post an update to incident ${input.incidentId}${statusNote}.`,
      payload: input,
    };
  };

  return {
    name: "incident.addUpdate",
    description:
      "Post a status update (timeline entry) to an incident, optionally changing its status (investigating/identified/fixing/monitoring/resolved). Never posts directly; a person must approve unless the conversation is in auto mode. Find the incidentId with the incident read tools first.",
    effect: "mutate",
    input: AddIncidentUpdateInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, incidentAccess.incident.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const incidentClient = rpcClient.forPlugin(IncidentApi);
      const update = await incidentClient.addUpdate(input);
      return { update };
    },
  };
}
