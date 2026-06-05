import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcClient, AuthUser } from "@checkstack/backend-api";
import {
  IncidentApi,
  incidentAccess,
  pluginMetadata,
  UpdateIncidentInputSchema,
  type UpdateIncidentInput,
  type IncidentWithSystems,
} from "@checkstack/incident-common";
import { computeFieldDiff, type AiProposalPreview } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "@checkstack/ai-backend";

/** Output returned once a human applies the update (the updated incident). */
export interface IncidentUpdateApplyResult {
  incident: IncidentWithSystems;
}

/**
 * `incident.update` - edit an existing incident's metadata (title, description,
 * severity, suppressNotifications, affected systems) by id. Only the provided
 * fields change.
 *
 * `effect: "mutate"` - a non-destructive change, so it auto-applies in AUTO mode
 * and is confirm-gated in APPROVE mode. `dryRun` fetches the live incident,
 * computes a before -> after diff over the updatable fields, and rejects an
 * unknown id with a self-correcting error; `execute` performs the update. The
 * underlying RPC uses the USER-SCOPED client passed at call time, so
 * handler-side authorization is enforced exactly as a direct UI/RPC call.
 */
export function createIncidentUpdateTool(): RegisteredAiTool<
  UpdateIncidentInput,
  IncidentUpdateApplyResult
> {
  const dryRun = async ({
    input,
    rpcClient,
  }: {
    input: UpdateIncidentInput;
    principal: AuthUser;
    rpcClient: RpcClient;
  }): Promise<AiProposalPreview<UpdateIncidentInput>> => {
    const incidentClient = rpcClient.forPlugin(IncidentApi);
    const existing = await incidentClient.getIncident({ id: input.id });
    if (!existing) {
      throw new Error(
        `No incident found with id "${input.id}". List incidents first to get a valid id.`,
      );
    }
    // before -> after over the updatable subset only (the full incident also
    // carries status/timestamps/updates/links that are not part of an update).
    const before = {
      title: existing.title,
      description: existing.description,
      severity: existing.severity,
      suppressNotifications: existing.suppressNotifications,
      systemIds: existing.systemIds,
    };
    const after = {
      title: input.title ?? before.title,
      description:
        input.description === undefined
          ? before.description
          : (input.description ?? undefined),
      severity: input.severity ?? before.severity,
      suppressNotifications:
        input.suppressNotifications ?? before.suppressNotifications,
      systemIds: input.systemIds ?? before.systemIds,
    };
    const diff = computeFieldDiff({ before, after });
    return {
      summary: `Update incident "${after.title}" (severity ${after.severity}, ${after.systemIds.length} system(s)).`,
      payload: input,
      diff,
    };
  };

  return {
    name: "incident.update",
    description:
      "Update an existing incident by id with the provided fields (title, description, severity, suppressNotifications, systemIds). Only provided fields change. Never updates directly; a person must approve unless the conversation is in auto mode. Find the id with the incident read tools first.",
    effect: "mutate",
    input: UpdateIncidentInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(pluginMetadata, incidentAccess.incident.manage),
    ],
    dryRun,
    async execute({ input, rpcClient }) {
      const incidentClient = rpcClient.forPlugin(IncidentApi);
      const incident = await incidentClient.updateIncident(input);
      return { incident };
    },
  };
}
