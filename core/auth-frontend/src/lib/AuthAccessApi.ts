import { AccessApi, usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import { useAccessRules } from "../hooks/useAccessRules";
import {
  isAccessRuleSatisfied,
  resolveProcedureGate,
  type AccessRule,
  type ProcedureWithMeta,
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

  /**
   * Shared surface-gate resolver (string-typed): the caller holds the global
   * `accessRule`, OR a team of theirs can create/manage-any object of
   * `objectType` (or `parentType`). Backs both `useCanAccessType` and the
   * contract-derived `useSurfaceAccess`.
   */
  private useTypeSurface(
    accessRule: AccessRule,
    objectType: string,
    parentType?: string,
  ): { loading: boolean; allowed: boolean } {
    // ONE `useAccessRules` serves both the global-RBAC check and the
    // authenticated gate. This hook runs once per gated control - on
    // gate-heavy pages (e.g. a per-row slot filler on the catalog manager)
    // that is once per ROW - so a redundant session/rules observer pair per
    // call multiplies into real allocation churn (see the ExtensionSlot memo
    // note in frontend-api).
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    const rulesState = useAccessRules();
    const { accessRules, loading: rulesLoading, isAuthenticated } = rulesState;
    // Global RBAC path grants the surface outright (empty rules never satisfy).
    const globalAllowed =
      !rulesLoading &&
      accessRules.length > 0 &&
      isAccessRuleSatisfied(accessRules, accessRule);

    // Team-derived path: the set of types the caller can create/manage-any of.
    // Only fetched when the global path hasn't already granted access. One small
    // query serves every surface gate on the page (React Query dedupes the key).
    // Anonymous callers never fetch: the procedure is authenticated-only.
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    const authClient = usePluginClient(AuthApi);
    const { data, isLoading } = authClient.myManageableTypes.useQuery(
      {},
      { enabled: !rulesLoading && !globalAllowed && isAuthenticated },
    );

    if (globalAllowed) return { loading: false, allowed: true };
    if (rulesLoading) return { loading: true, allowed: false };
    const types = new Set(data?.types);
    const allowed =
      types.has(objectType) ||
      (parentType !== undefined && types.has(parentType));
    return { loading: isLoading, allowed };
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
    return this.useTypeSurface(accessRule, objectType, parentType);
  }

  useSurfaceAccess(
    procedure: ProcedureWithMeta,
  ): { loading: boolean; allowed: boolean } {
    // Derive the surface gate from a REPRESENTATIVE procedure of the page: its
    // access rule + the resource type (and parent type) it touches, straight
    // from the contract. No hand-passed objectType/parentType to drift. Compose
    // by OR-ing several `useSurfaceAccess` calls for a multi-type page.
    const gate = resolveProcedureGate({ procedure });
    return this.useTypeSurface(gate.accessRule, gate.objectType, gate.parentType);
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

  useProcedureAccess(
    procedure: ProcedureWithMeta,
    input?: unknown,
  ): { loading: boolean; allowed: boolean } {
    // The gate the backend will actually enforce, derived (not hand-picked)
    // from the procedure's contract metadata. Pure + synchronous, so it never
    // affects the hook count below.
    const gate = resolveProcedureGate({ procedure, input });

    // Every hook is called UNCONDITIONALLY (stable hook count across renders,
    // like `useRouteAccess`); each team-derived query is gated to its own mode
    // via `enabled`, so exactly the relevant one fetches - and only when the
    // global RBAC path hasn't already granted access. Anonymous callers never
    // fetch: these procedures are authenticated-only.
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    const rulesState = useAccessRules();
    const { accessRules, loading: rulesLoading, isAuthenticated } = rulesState;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    const authClient = usePluginClient(AuthApi);

    // The global-RBAC check runs against the gate's access rule (for a
    // parentScope gate that is the reconstructed PARENT rule). For a
    // `create.parent` gate we ALSO OR in global manage on the parent type, so a
    // global parent-manager is offered the create affordance (mirrors the
    // backend's parent-gated create).
    const globalAllowed =
      isAccessRuleSatisfied(accessRules, gate.accessRule) ||
      (gate.parentAccessRule !== undefined &&
        isAccessRuleSatisfied(accessRules, gate.parentAccessRule));
    const teamEnabled = !rulesLoading && !globalAllowed && isAuthenticated;

    const createQuery = authClient.canCreate.useQuery(
      {
        objectType: gate.objectType,
        parentType: gate.parentType,
        alsoAcceptCreatorOf: gate.alsoAcceptCreatorOf,
      },
      { enabled: teamEnabled && gate.kind === "create" },
    );
    const typesQuery = authClient.myManageableTypes.useQuery(
      {},
      { enabled: teamEnabled && gate.kind === "typeScoped" },
    );
    const idResourceIds = gate.resourceId ? [gate.resourceId] : [];
    const idQuery = authClient.listMyAccessibleResources.useQuery(
      {
        objectType: gate.objectType,
        resourceIds: idResourceIds,
        action: gate.action,
      },
      {
        enabled:
          teamEnabled && gate.kind === "idParam" && idResourceIds.length > 0,
      },
    );

    // Post-filtered surfaces (list/record/bulk, and the parentScope recordKey
    // variant) have no pre-gate: the server returns the caller's authorized
    // subset.
    if (gate.kind === "open") return { loading: false, allowed: true };
    if (rulesLoading) return { loading: true, allowed: false };
    if (globalAllowed) return { loading: false, allowed: true };

    switch (gate.kind) {
      case "global": {
        return { loading: false, allowed: false };
      }
      case "create": {
        return {
          loading: createQuery.isLoading,
          allowed: createQuery.data?.allowed ?? false,
        };
      }
      case "typeScoped": {
        const types = new Set(typesQuery.data?.types);
        const allowed =
          types.has(gate.objectType) ||
          (gate.parentType !== undefined && types.has(gate.parentType));
        return { loading: typesQuery.isLoading, allowed };
      }
      case "idParam": {
        if (!gate.resourceId) return { loading: false, allowed: false };
        const accessible = new Set(idQuery.data?.accessibleIds);
        return {
          loading: idQuery.isLoading,
          allowed: accessible.has(gate.resourceId),
        };
      }
      default: {
        return { loading: false, allowed: false };
      }
    }
  }
}
