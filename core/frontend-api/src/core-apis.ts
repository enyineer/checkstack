import {
  AccessRule,
  ClientDefinition,
  InferClient,
  ProcedureWithMeta,
  ResourceType,
} from "@checkstack/common";
import { createApiRef } from "./api-ref";

export interface LoggerApi {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export interface FetchApi {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  forPlugin(pluginId: string): {
    fetch(path: string, init?: RequestInit): Promise<Response>;
  };
}

export const loggerApiRef = createApiRef<LoggerApi>("core.logger");
export const fetchApiRef = createApiRef<FetchApi>("core.fetch");

/**
 * Unified access API for checking user access via AccessRules.
 *
 * Uses the same AccessRule objects from plugin common packages
 * that are used in backend contracts.
 */
export interface AccessApi {
  /**
   * Check if the current user has access based on an AccessRule.
   *
   * @example
   * ```tsx
   * import { catalogAccess } from "@checkstack/catalog-common";
   *
   * const { allowed, loading } = accessApi.useAccess(catalogAccess.system.manage);
   * if (allowed) {
   *   // User can manage systems
   * }
   * ```
   */
  useAccess(accessRule: AccessRule): { loading: boolean; allowed: boolean };
  /**
   * Management-surface gate: may the user reach a management page / nav entry for
   * this resource type at all? True when the user holds the global `accessRule`
   * (RBAC), OR a team of theirs can create or manage ANY object of `objectType`
   * (ReBAC), OR - when `parentType` is given - manage any object of the parent
   * type (e.g. managing a system lets you reach the incidents surface for it).
   *
   * Use this for the coarse "can they see this surface" decision - route guards,
   * sidebar entries, and a management page's top-level `allowed`. Use
   * `useProcedureAccess` (or the fused `useGatedMutation`) for the create BUTTON
   * (a manager of an existing resource may see the page but not be allowed to
   * create new ones) and `useResourceAccess` for per-row controls.
   */
  useCanAccessType(params: {
    accessRule: AccessRule;
    objectType: ResourceType;
    parentType?: ResourceType;
  }): { loading: boolean; allowed: boolean };
  /**
   * Contract-derived coarse surface gate: same "can the user reach this
   * management surface at all" decision as `useCanAccessType`, but the access
   * rule + object type (+ parent type) are DERIVED from a REPRESENTATIVE
   * procedure of the page instead of hand-passed - so they cannot drift from the
   * contract. Pass any procedure of the page's primary type (e.g. its list or
   * create proc); OR several calls for a multi-type page.
   *
   * @example
   * ```tsx
   * const { allowed } = accessApi.useSurfaceAccess(AutomationApi.contract.listAutomations);
   * ```
   */
  useSurfaceAccess(
    procedure: ProcedureWithMeta,
  ): { loading: boolean; allowed: boolean };
  /**
   * Route/nav guard gate. Resolves visibility for a route that may declare an
   * `accessRule` and/or a `manageCapability`: allowed when the global rule is
   * satisfied OR (when a capability is declared) the user can create/manage the
   * type or its parent via a team. Unlike composing `useAccess` /
   * `useCanAccessType` conditionally, this calls a CONSTANT set of hooks
   * regardless of which fields are present, so it is safe to call from a guard
   * component that is reused across route changes (React's rules of hooks).
   */
  useRouteAccess(params: {
    accessRule?: AccessRule;
    manageCapability?: {
      objectType: ResourceType;
      parentType?: ResourceType;
    };
  }): { loading: boolean; allowed: boolean };
  /**
   * Per-resource access gate. Given a list of resource ids, resolves which the
   * current user may act on at `action` level, considering BOTH the global
   * `accessRule` (RBAC — grants ALL rows) AND team-derived per-object grants
   * (ReBAC). Use to gate per-row edit/delete/manage controls so a user who
   * manages system X never sees a manage action for system Y they cannot touch.
   *
   * Returns a `canAccess(id)` predicate. While loading, `canAccess` returns
   * `false` (fail-closed) — pair with `loading` if you want to defer rendering.
   * `action` defaults to `"manage"`.
   *
   * @example
   * ```tsx
   * const { canAccess } = accessApi.useResourceAccess({
   *   accessRule: catalogAccess.system.manage,
   *   objectType: "catalog.system",
   *   resourceIds: systems.map((s) => s.id),
   * });
   * // ...
   * {canAccess(system.id) && <EditButton />}
   * ```
   */
  useResourceAccess(params: {
    accessRule: AccessRule;
    objectType: ResourceType;
    resourceIds: string[];
    action?: "read" | "manage";
  }): {
    loading: boolean;
    /** True when the user has the global rule (every id is accessible). */
    hasGlobal: boolean;
    /** Predicate: may the user act on this id? False while loading. */
    canAccess: (id: string) => boolean;
  };
  /**
   * Whether the current user is authenticated (logged in). Use to gate UI that
   * needs a real user but no specific access rule - e.g. per-user actions like
   * muting your own anomaly notifications, which any logged-in user may do but
   * an anonymous visitor may not.
   *
   * @example
   * ```tsx
   * const { isAuthenticated } = accessApi.useIsAuthenticated();
   * if (isAuthenticated) {
   *   // show the per-user action
   * }
   * ```
   */
  useIsAuthenticated(): { loading: boolean; isAuthenticated: boolean };
  /**
   * DERIVED gate: resolve the exact authorization a procedure requires straight
   * from its contract metadata (`access` + `instanceAccess`), instead of the
   * caller hand-picking which of the hooks above matches the backend mode.
   *
   * Pass the contract procedure (e.g. `AutomationApi.contract.updateAutomation`)
   * and, for per-instance modes, the input about to be sent. The hook reads the
   * declared mode and dispatches: `global` → `useAccess`, `idParam` →
   * per-instance grant on the resolved id, `create` → create capability,
   * `typeScoped` → global-or-any-team-grant, `listKey`/`recordKey`/`bulkManage`
   * → open (server post-filters). `parentScope` (a for-parent read/write) is
   * normalized to an `idParam`/`open` gate on the parent type + a reconstructed
   * parent rule. Because the mode is derived, a call site can no longer gate on
   * the wrong thing - the drift class the "global-only team-grant" audit
   * surfaced.
   *
   * @example
   * ```tsx
   * // Per-instance edit gate - no hand-picked hook, no restated objectType:
   * const { allowed } = accessApi.useProcedureAccess(
   *   AutomationApi.contract.updateAutomation,
   *   { id: automationId },
   * );
   * // Create gate:
   * const { allowed } = accessApi.useProcedureAccess(
   *   AutomationApi.contract.createAutomation,
   * );
   * ```
   */
  useProcedureAccess(
    procedure: ProcedureWithMeta,
    input?: unknown,
  ): { loading: boolean; allowed: boolean };
}

export const accessApiRef = createApiRef<AccessApi>("core.access");

export interface RpcApi {
  client: unknown;
  forPlugin<T extends ClientDefinition>(def: T): InferClient<T>;
}

export const rpcApiRef = createApiRef<RpcApi>("core.rpc");
