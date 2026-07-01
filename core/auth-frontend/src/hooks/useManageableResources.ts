import { useMemo } from "react";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import type { AccessRule, ResourceType } from "@checkstack/common";
import { selectManageable } from "../lib/selectManageable";

export interface UseManageableResourcesParams<T> {
  /** The full candidate list (e.g. every system fetched from the catalog). */
  items: readonly T[];
  /** Stable id extractor for an item. */
  getId: (item: T) => string;
  /** The write rule the resource is gated on (e.g. `catalogAccess.system.manage`). */
  accessRule: AccessRule;
  /** The qualified resource type (e.g. `catalogResourceTypes.system`). */
  objectType: ResourceType;
  /** Access level to check; defaults to "manage" (matches the picker use case). */
  action?: "read" | "manage";
  /**
   * Ids to keep in `manageable` regardless of access - typically the values
   * already selected, so an existing selection the caller can no longer manage
   * stays visible (and removable) instead of vanishing.
   */
  keepIds?: Iterable<string>;
  /**
   * Force "offer everything" even without a per-resource global grant. Pass the
   * verdict of a HIGHER rule that authorizes targeting any instance - e.g. a
   * global incident manager may reference ANY system, so the incident picker
   * passes `accessApi.useAccess(incidentAccess.incident.manage).allowed` here.
   */
  allowAllOverride?: boolean;
}

export interface UseManageableResourcesResult<T> {
  loading: boolean;
  /** The caller may select any item (global per-resource grant OR the override). */
  allowAll: boolean;
  /** Per-resource predicate (false while loading). */
  canAccess: (id: string) => boolean;
  /** The items a picker should OFFER (see `selectManageable`). */
  manageable: T[];
}

/**
 * The one hook a RLAC-aware resource picker needs: filters a candidate list to
 * exactly what the backend will accept from this caller, so the picker never
 * offers a resource the submit would reject. Wraps `accessApi.useResourceAccess`
 * with the shared `selectManageable` policy - use it instead of re-deriving the
 * `hasGlobal ? all : filter(canAccess)` dance in every picker.
 */
export function useManageableResources<T>({
  items,
  getId,
  accessRule,
  objectType,
  action = "manage",
  keepIds,
  allowAllOverride = false,
}: UseManageableResourcesParams<T>): UseManageableResourcesResult<T> {
  const accessApi = useApi(accessApiRef);
  const resourceIds = useMemo(
    () => items.map((item) => getId(item)),
    [items, getId],
  );
  const { loading, hasGlobal, canAccess } = accessApi.useResourceAccess({
    accessRule,
    objectType,
    resourceIds,
    action,
  });
  const allowAll = hasGlobal || allowAllOverride;

  const keepSet = useMemo(
    () => (keepIds ? new Set(keepIds) : undefined),
    [keepIds],
  );
  const manageable = useMemo(
    () => selectManageable({ items, getId, allowAll, canAccess, keepIds: keepSet }),
    [items, getId, allowAll, canAccess, keepSet],
  );

  return { loading, allowAll, canAccess, manageable };
}
