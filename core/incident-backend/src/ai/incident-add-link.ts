import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  IncidentApi,
  incidentAccess,
  pluginMetadata,
  AddIncidentLinkInputSchema,
  type AddIncidentLinkInput,
  type IncidentLink,
} from "@checkstack/incident-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/** Output returned once a human applies the link add (the created link). */
export interface IncidentAddLinkApplyResult {
  link: IncidentLink;
}

/**
 * `incident.addLink` - attach a hotlink (e.g. Jira ticket, runbook) to an
 * incident.
 *
 * `effect: "mutate"` - adding a link is a non-destructive change, so it
 * auto-applies in AUTO mode and is confirm-gated in APPROVE mode. `dryRun`
 * returns the captured payload for human review WITHOUT mutating; `execute`
 * (reached only via `apply`) attaches the link. The underlying RPC uses the
 * USER-SCOPED client passed at call time, so handler-side authorization is
 * enforced exactly as a direct UI/RPC call.
 */
export function createIncidentAddLinkTool(): RegisteredAiTool<
  AddIncidentLinkInput,
  IncidentAddLinkApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: AddIncidentLinkInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<AddIncidentLinkInput>> => {
    return {
      summary: `Add link ${input.label ? `"${input.label}" ` : ""}(${input.url}) to incident ${input.incidentId}.`,
      payload: input,
    };
  };

  return {
    name: "incident.addLink",
    description:
      "Attach a hotlink (e.g. Jira ticket, runbook, status page) to an incident with an optional label and a URL. Never adds directly; a person must approve unless the conversation is in auto mode. Find the incidentId with the incident read tools first.",
    effect: "mutate",
    input: AddIncidentLinkInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, incidentAccess.incident.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const incidentClient = rpcClient.forPlugin(IncidentApi);
      const link = await incidentClient.addLink(input);
      return { link };
    },
  };
}
