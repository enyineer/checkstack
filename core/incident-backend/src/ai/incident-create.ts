import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  IncidentApi,
  incidentAccess,
  pluginMetadata,
  CreateIncidentInputSchema,
  type CreateIncidentInput,
  type IncidentWithSystems,
} from "@checkstack/incident-common";
import type { AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/** Output returned once a human applies the create (the created incident). */
export interface IncidentCreateApplyResult {
  incident: IncidentWithSystems;
}

/**
 * `incident.create` - open a new incident affecting one or more systems.
 *
 * `effect: "mutate"` - creating an incident is a non-destructive create, so it
 * auto-applies in AUTO mode and is confirm-gated in APPROVE mode. `dryRun`
 * returns the captured payload for human review WITHOUT mutating; `execute`
 * (reached only via `apply`) performs the create. Authorization is the same
 * `incident.manage` rule the UI create form requires; the underlying RPC uses
 * the USER-SCOPED client passed at call time, so handler-side authorization
 * (access rules AND per-resource/team scoping) is enforced exactly as a direct
 * UI/RPC call.
 */
export function createIncidentCreateTool(): RegisteredAiTool<
  CreateIncidentInput,
  IncidentCreateApplyResult
> {
  const dryRun = async ({
    input,
  }: {
    input: CreateIncidentInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<CreateIncidentInput>> => {
    const systemCount = input.systemIds.length;
    return {
      summary: `Create ${input.severity} incident "${input.title}" affecting ${systemCount} system(s)${input.suppressNotifications ? " (notifications suppressed)" : ""}.`,
      payload: input,
    };
  };

  return {
    name: "incident.create",
    description:
      "Open a new incident affecting one or more systems. Provide a title, severity (minor/major/critical), and the affected systemIds. Never creates directly; a person must approve unless the conversation is in auto mode. Find systemIds with the catalog read tools first.",
    effect: "mutate",
    input: CreateIncidentInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, incidentAccess.incident.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const incidentClient = rpcClient.forPlugin(IncidentApi);
      const incident = await incidentClient.createIncident(input);
      return { incident };
    },
  };
}
