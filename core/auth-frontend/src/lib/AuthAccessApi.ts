import { AccessApi, usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import { useAccessRules } from "../hooks/useAccessRules";
import {
  isAccessRuleSatisfied,
  type AccessRule,
  type ResourceType,
} from "@checkstack/common";

/**
 * Stable `canAccess` predicates so consumers can safely list the result in a
 * React effect/memo dependency array without looping. The global/loading cases
 * are module constants; the per-subset case is cached by the accessible-id
 * array's identity - React Query keeps that array referentially stable until the
 * query result actually changes, so the same subset yields the same function.
 * (A hook like `useMemo` can't be used here: these methods are invoked through
 * the `AccessApi` adapter, including outside a render in unit tests.)
 */
const ALWAYS_TRUE = (): boolean => true;
const ALWAYS_FALSE = (): boolean => false;
const canAccessBySubset = new WeakMap<
  readonly string[],
  (id: string) => boolean
>();

/**
 * Unified access API implementation.
 * Uses AccessRule objects for access checks.
 */
export class AuthAccessApi implements AccessApi {
  useAccess(accessRule: AccessRule): { loading: boolean; allowed: boolean } {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    const { accessRules, loading } = useAccessRules();

    if (loading) {
      return { loading: true, allowed: false };
    }

    // If no user, or user has no access rules, return false
    if (!accessRules || accessRules.length === 0) {
      return { loading: false, allowed: false };
    }

    return {
      loading: false,
      allowed: isAccessRuleSatisfied(accessRules, accessRule),
    };
  }

  useCanCreate({
    accessRule,
    objectType,
    parentType,
  }: {
    accessRule: AccessRule;
    objectType: ResourceType;
    parentType?: ResourceType;
  }): { loading: boolean; allowed: boolean } {
    // Global RBAC path. If the user holds the manage rule, we're done — no need
    // to hit the team-capability query.
    const global = this.useAccess(accessRule);

    // Team-derived (ReBAC) path: resolved server-side against the caller's team
    // `creator`/parent-manage grants. Only fetched when the global path hasn't
    // already granted access, so most (admin/global) callers pay no extra round
    // trip. Anonymous callers never fetch: the procedure is authenticated-only
    // (a guest holds no team grants), so calling it would just 401.
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    const { isAuthenticated } = useAccessRules();
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    const authClient = usePluginClient(AuthApi);
    const { data, isLoading } = authClient.canCreate.useQuery(
      { objectType, parentType },
      { enabled: !global.loading && !global.allowed && isAuthenticated },
    );

    if (global.allowed) return { loading: false, allowed: true };
    if (global.loading) return { loading: true, allowed: false };
    return { loading: isLoading, allowed: data?.allowed ?? false };
  }

  useCanAccessType({
    accessRule,
    objectType,
    parentType,
  }: {
    accessRule: AccessRule;
    objectType: ResourceType;
    parentType?: ResourceType;
  }): { loading: boolean; allowed: boolean } {
    // Global RBAC path grants the surface outright.
    const global = this.useAccess(accessRule);

    // Team-derived path: the set of types the caller can create/manage-any of.
    // Only fetched when the global path hasn't already granted access. One small
    // query serves every surface gate on the page (React Query dedupes the key).
    // Anonymous callers never fetch: the procedure is authenticated-only.
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    const { isAuthenticated } = useAccessRules();
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    const authClient = usePluginClient(AuthApi);
    const { data, isLoading } = authClient.myManageableTypes.useQuery(
      {},
      { enabled: !global.loading && !global.allowed && isAuthenticated },
    );

    if (global.allowed) return { loading: false, allowed: true };
    if (global.loading) return { loading: true, allowed: false };
    const types = new Set(data?.types);
    const allowed =
      types.has(objectType) ||
      (parentType !== undefined && types.has(parentType));
    return { loading: isLoading, allowed };
  }

  useRouteAccess({
    accessRule,
    manageCapability,
  }: {
    accessRule?: AccessRule;
    manageCapability?: { objectType: ResourceType; parentType?: ResourceType };
  }): { loading: boolean; allowed: boolean } {
    // Every hook below is called UNCONDITIONALLY so the hook count is identical
    // on every render, whatever `accessRule`/`manageCapability` are. This guard
    // is reused as the URL changes (React reconciles it in place rather than
    // remounting), so branching the hook calls would trip "Rendered fewer/more
    // hooks than expected".
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    const rulesState = useAccessRules();
    const { accessRules, loading: rulesLoading, isAuthenticated } = rulesState;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    const authClient = usePluginClient(AuthApi);

    const globalAllowed =
      accessRule === undefined
        ? true
        : isAccessRuleSatisfied(accessRules, accessRule);

    // Anonymous callers never fetch: the procedure is authenticated-only (a
    // guest holds no team grants), so calling it would just 401.
    const { data, isLoading } = authClient.myManageableTypes.useQuery(
      {},
      {
        enabled:
          manageCapability !== undefined &&
          !rulesLoading &&
          !globalAllowed &&
          isAuthenticated,
      },
    );

    // A route with a rule still resolving: wait. (No rule => nothing to load.)
    if (accessRule !== undefined && rulesLoading) {
      return { loading: true, allowed: false };
    }
    if (globalAllowed) return { loading: false, allowed: true };
    if (manageCapability === undefined) {
      return { loading: false, allowed: false };
    }
    const types = new Set(data?.types);
    const allowed =
      types.has(manageCapability.objectType) ||
      (manageCapability.parentType !== undefined &&
        types.has(manageCapability.parentType));
    return { loading: isLoading, allowed };
  }

  useResourceAccess({
    accessRule,
    objectType,
    resourceIds,
    action = "manage",
  }: {
    accessRule: AccessRule;
    objectType: ResourceType;
    resourceIds: string[];
    action?: "read" | "manage";
  }): {
    loading: boolean;
    hasGlobal: boolean;
    canAccess: (id: string) => boolean;
  } {
    // Global RBAC path grants every row at once.
    const global = this.useAccess(accessRule);

    // Team-derived subset — only fetched when the global path hasn't already
    // granted access, and only for the ids actually on screen. Anonymous
    // callers never fetch: the procedure is authenticated-only (a guest holds
    // no team grants), so calling it would just 401.
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    const { isAuthenticated } = useAccessRules();
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    const authClient = usePluginClient(AuthApi);
    const ids = [...new Set(resourceIds)];
    const { data, isLoading } = authClient.listMyAccessibleResources.useQuery(
      { objectType, resourceIds: ids, action },
      {
        enabled:
          !global.loading &&
          !global.allowed &&
          isAuthenticated &&
          ids.length > 0,
      },
    );

    const hasGlobal = global.allowed;
    const globalLoading = global.loading;
    const accessibleIds = data?.accessibleIds;
    // `canAccess` MUST be referentially stable: consumers list it in effect /
    // memo dependency arrays (e.g. a ReactFlow node builder that calls
    // setNodes), and a fresh function each render would loop them
    // ("Maximum update depth exceeded"). See the module-level cache note.
    let canAccess: (id: string) => boolean;
    if (hasGlobal) {
      canAccess = ALWAYS_TRUE;
    } else if (globalLoading || !accessibleIds) {
      canAccess = ALWAYS_FALSE;
    } else {
      const cached = canAccessBySubset.get(accessibleIds);
      if (cached) {
        canAccess = cached;
      } else {
        const accessible = new Set(accessibleIds);
        canAccess = (id: string) => accessible.has(id);
        canAccessBySubset.set(accessibleIds, canAccess);
      }
    }

    return {
      loading: hasGlobal ? false : globalLoading ? true : isLoading,
      hasGlobal,
      canAccess,
    };
  }

  useIsAuthenticated(): { loading: boolean; isAuthenticated: boolean } {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    const { loading, isAuthenticated } = useAccessRules();
    return { loading, isAuthenticated };
  }
}
