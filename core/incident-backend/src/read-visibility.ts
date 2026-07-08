import { qualifyAccessRuleId } from "@checkstack/common";
import type { RpcContext, AuthService } from "@checkstack/backend-api";
import {
  incidentAccess,
  incidentResourceTypes,
  pluginMetadata,
  type IncidentVisibility,
} from "@checkstack/incident-common";

/**
 * Read-path audience level for the caller. Drives which incident updates/links
 * ship in a payload (Item 3/5): filtering is enforced SERVER-SIDE here, never
 * via CSS - a hidden item is never serialized.
 *
 * - `public`: anonymous callers and the public status-page projection.
 * - `authenticated`: a logged-in user who cannot manage this incident.
 * - `manager`: a global incident manager, a team-scoped manager of THIS
 *   incident, or a trusted service call.
 */
export type ReadAudience = "public" | "authenticated" | "manager";

/** Whether an item of the given visibility is exposed at the caller's audience. */
export function isVisibleAtAudience(
  visibility: IncidentVisibility,
  audience: ReadAudience,
): boolean {
  if (audience === "manager") return true;
  if (audience === "authenticated") return visibility !== "internal";
  return visibility === "public";
}

/** Filter a list of visibility-carrying items to what the audience may see. */
export function filterByAudience<T extends { visibility: IncidentVisibility }>(
  items: T[],
  audience: ReadAudience,
): T[] {
  return items.filter((item) => isVisibleAtAudience(item.visibility, audience));
}

/**
 * Strip the manager-only `editHistory` from updates for any non-manager
 * audience. An update's CURRENT visibility gates the whole row, but a PRIOR
 * version archived in `editHistory` could have been `internal` before being made
 * `public` - so exposing history to a public / logged-in reader would leak prior
 * internal content. The simplest safe rule (and the one applied here): edit
 * history is manager-only. Managers get the array untouched; everyone else gets
 * it removed from the payload.
 */
export function scopeEditHistory<T extends { editHistory?: unknown }>(
  updates: T[],
  audience: ReadAudience,
): T[] {
  if (audience === "manager") return updates;
  return updates.map((u) => ({ ...u, editHistory: undefined }));
}

/**
 * Resolve the caller's audience for a specific incident. A trusted service call
 * is treated as `manager` (server-to-server reads are not the public surface -
 * the public status page filters to `public` separately in its widget). An
 * anonymous caller (no user) is `public`. Otherwise the caller is a `manager`
 * when they hold the global manage rule OR a team grant to manage THIS incident.
 */
export async function resolveIncidentAudience({
  context,
  incidentId,
}: {
  // Only the caller + the auth `check` are needed; a narrow shape keeps this
  // unit testable without constructing a full RpcContext / AuthService.
  context: { user: RpcContext["user"]; auth: Pick<AuthService, "check"> };
  incidentId: string;
}): Promise<ReadAudience> {
  const user = context.user;
  if (!user) return "public";
  if (user.type === "service") return "manager";

  const manageRuleId = qualifyAccessRuleId(
    pluginMetadata,
    incidentAccess.incident.manage,
  );
  const rules = user.accessRules ?? [];
  const hasGlobalManage =
    rules.includes("*") || rules.includes(manageRuleId);
  if (hasGlobalManage) return "manager";

  if (user.type === "user" || user.type === "application") {
    const { hasAccess } = await context.auth.check({
      userId: user.id,
      userType: user.type,
      objectType: incidentResourceTypes.incident,
      objectId: incidentId,
      action: "manage",
      hasGlobalAccess: false,
    });
    if (hasAccess) return "manager";
  }

  return "authenticated";
}
