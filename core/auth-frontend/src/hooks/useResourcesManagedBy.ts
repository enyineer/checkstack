import { useMemo } from "react";
import {
  useApi,
  usePluginClient,
  accessApiRef,
} from "@checkstack/frontend-api";
import { AuthApi, authAccess } from "@checkstack/auth-common";
import {
  deriveTeamAccessSummary,
  type TeamAccessSummary,
} from "../lib/deriveTeamAccessSummary";

export interface UseResourcesManagedByParams {
  /** Qualified resource type, e.g. "catalog.group". */
  resourceType: string;
  /** The ids of every row to resolve ownership for (resolved in ONE query). */
  resourceIds: string[];
}

export interface ResourceOwnership {
  summary: TeamAccessSummary;
  /**
   * The team names to show: the managing teams for a "managed" resource, the
   * listed teams for a "private" one; empty for "open"/"readonly-grants".
   */
  teamNames: string[];
}

export interface UseResourcesManagedByResult {
  loading: boolean;
  /**
   * False when the viewer lacks `auth.teams.read`. Callers should render no
   * owner UI at all in that case (the same passive-degradation contract as
   * {@link ResourceManagedBy}).
   */
  canReadTeams: boolean;
  /** Ownership for one id, or undefined until loaded / when not team-scoped. */
  getOwnership: (id: string) => ResourceOwnership | undefined;
}

/**
 * Batched, table-friendly counterpart to `ResourceManagedBy`: resolves the
 * owning team(s) for MANY resources of one type in a single `listObjectRelations
 * Bulk` query, so a management table can show a per-row owner badge without an
 * N+1. Reuses `deriveTeamAccessSummary`, so its "managed"/"private"/"open"
 * semantics match the detail-page indicator and the edit-mode editor exactly.
 * Gated on `auth.teams.read` — returns `canReadTeams: false` (and no ownership)
 * for a viewer who cannot read teams.
 */
export function useResourcesManagedBy({
  resourceType,
  resourceIds,
}: UseResourcesManagedByParams): UseResourcesManagedByResult {
  const accessApi = useApi(accessApiRef);
  const authClient = usePluginClient(AuthApi);
  const { allowed: canReadTeams } = accessApi.useAccess(authAccess.teams.read);

  // Stable, deduped, ordered id set so the query key doesn't churn when the
  // caller passes the same ids in a different render-order.
  const ids = useMemo(
    () => [...new Set(resourceIds)].toSorted(),
    [resourceIds],
  );

  const { data, isLoading } = authClient.listObjectRelationsBulk.useQuery(
    { objectType: resourceType, objectIds: ids },
    { enabled: canReadTeams && ids.length > 0 },
  );

  const byId = useMemo(() => {
    const map = new Map<string, ResourceOwnership>();
    if (!data) return map;
    for (const obj of data.objects) {
      // Any relation grants read; editor/owner also manage (matches
      // ResourceManagedBy / TeamAccessEditor).
      const accessList = obj.teams.map((t) => ({
        teamName: t.teamName,
        canManage: t.relation !== "viewer",
      }));
      const summary = deriveTeamAccessSummary({
        accessList,
        teamOnly: !obj.isPublic,
      });
      const teamNames =
        summary.kind === "managed"
          ? summary.managingTeams
          : summary.kind === "private"
            ? summary.teams
            : [];
      map.set(obj.objectId, { summary, teamNames });
    }
    return map;
  }, [data]);

  return {
    loading: isLoading,
    canReadTeams,
    getOwnership: (id: string) => byId.get(id),
  };
}
