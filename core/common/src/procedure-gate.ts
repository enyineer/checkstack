import type { AccessRule } from "./access-utils";
import type { ProcedureMetadata } from "./types";
import { qualifyResourceType } from "./types";

/**
 * Frontend authorization gating DERIVED from a procedure's contract metadata.
 *
 * The backend contract already declares, per procedure, BOTH the access rule
 * (`access`) AND how that rule is scoped to instances (`instanceAccess`). The
 * frontend gate is the client-side mirror of exactly that declaration - which,
 * until now, every call site RE-ENCODED by hand (reading "this proc is idParam"
 * and manually picking `useResourceAccess`, etc.). That hand-mapping is the
 * source of the "global-only team-grant" drift class: nothing enforced that the
 * hook a page picked matched the mode the contract declared.
 *
 * `resolveProcedureGate` collapses that mapping into a single pure function:
 * given a contract procedure (and, for per-instance modes, the input about to be
 * sent), it returns the ONE gate the backend will actually enforce. A UI hook
 * (`accessApi.useProcedureAccess`) dispatches on `kind`. Because the mapping is
 * derived, a call site can no longer pick the wrong check.
 *
 * `parentScope` (a for-parent read/write, e.g. "incidents for system X") is
 * NORMALIZED here into a plain `idParam`/`open` gate on a SYNTHETIC parent rule +
 * the parent type, so it needs no special dispatch and no explicit-hook fallback.
 */

/**
 * The classified gate the frontend must apply, matching the backend's
 * `autoAuthMiddleware` branches one-to-one.
 */
export type ProcedureGateKind =
  /** `listKey` / `recordKey` / `bulkManage`: results are post-filtered by the
   *  server, so there is no pre-gate - the surface is reachable and shows the
   *  caller's authorized subset. */
  | "open"
  /** No `instanceAccess`, or `instanceAccess.global`: require the GLOBAL rule. */
  | "global"
  /** `idParam`: per-instance read/manage grant on the resolved resource id. */
  | "idParam"
  /** `create`: create-capability (global manage OR a team creator/parent grant). */
  | "create"
  /** `typeScoped`: the GLOBAL rule OR ANY team grant of the resource type. */
  | "typeScoped";

/** The resolved, ready-to-check gate for a single procedure call. */
export interface ProcedureGate {
  kind: ProcedureGateKind;
  /**
   * The access rule the global-RBAC check runs against. For most gates this is
   * the procedure's own rule; for a `parentScope` gate it is the SYNTHETIC
   * PARENT rule reconstructed from the parent type + action (see the resolver).
   */
  accessRule: AccessRule;
  /**
   * Qualified resource type the team-grant check keys on (`pluginId.resource`) -
   * the SAME value the backend uses. For a `parentScope` gate this is the PARENT
   * type the check is delegated to.
   */
  objectType: string;
  /** Parent qualified type for `create.parent` (create gated by a parent grant). */
  parentType?: string;
  /**
   * For a `create.parent` gate, the SYNTHETIC parent MANAGE rule the global-RBAC
   * check ORs in - so a caller with global manage on the PARENT type (e.g. a
   * global system manager creating an incident "for" a system) is offered the
   * create affordance, matching the backend's parent-gated create. Absent for
   * gates with no parent.
   */
  parentAccessRule?: AccessRule;
  /**
   * For a `create.alsoAcceptCreatorOf` gate, the sibling qualified types whose
   * `creator` capability also authorizes this create. Passed to the `canCreate`
   * query so the team-side verdict matches the backend sibling gate.
   */
  alsoAcceptCreatorOf?: string[];
  /** The access level the check runs at (`read` / `manage`). */
  action: "read" | "manage";
  /**
   * Resolved resource id for `idParam` (or the parent id, for a `parentScope`
   * gate normalized to `idParam`), pulled from the call input via the contract's
   * declared path. `undefined` when the input did not carry it (e.g. gating a
   * control before an id exists).
   */
  resourceId?: string;
}

/** A contract procedure carries its `ProcedureMetadata` under oRPC's `~orpc.meta`. */
export interface ProcedureWithMeta {
  readonly "~orpc": { readonly meta: ProcedureMetadata };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Resolve a dot-notation path (e.g. `"params.systemId"`) against the input. */
function getByPath(input: unknown, path: string): unknown {
  let current: unknown = input;
  for (const key of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function resolvedId(input: unknown, path: string): string | undefined {
  const value = getByPath(input, path);
  return typeof value === "string" ? value : undefined;
}

/**
 * Reconstruct the AccessRule for a qualified resource type + level. The global
 * RBAC check reads only `id`/`resource`/`level`/`pluginId`, and the granted rule
 * string it matches is exactly `${qualifiedType}.${level}` - so a synthetic rule
 * split from `pluginId.resource` is faithful (used for `parentScope` and
 * `create.parent`, which reference the parent by qualified type string).
 */
function syntheticRule(
  qualifiedType: string,
  level: "read" | "manage",
): AccessRule {
  const dot = qualifiedType.indexOf(".");
  const pluginId = dot === -1 ? qualifiedType : qualifiedType.slice(0, dot);
  const resource = dot === -1 ? qualifiedType : qualifiedType.slice(dot + 1);
  return { id: `${resource}.${level}`, resource, pluginId, level, description: "" };
}

/**
 * Derive the frontend gate for a procedure call from its contract metadata.
 *
 * @param procedure - a contract procedure, e.g. `AutomationApi.contract.updateAutomation`
 * @param input - the input about to be sent (needed for `idParam`/`parentScope`
 *   to resolve the resource id); omit for id-less modes (`create`, `typeScoped`).
 */
export function resolveProcedureGate({
  procedure,
  input,
}: {
  procedure: ProcedureWithMeta;
  input?: unknown;
}): ProcedureGate {
  const meta = procedure["~orpc"].meta;
  const rules = meta.access ?? [];
  const accessRule = rules[0];
  if (!accessRule) {
    throw new Error(
      "resolveProcedureGate: procedure declares no access rule to gate on",
    );
  }

  // A contract-level `instanceAccess` override applies to ALL rules (the bulk
  // pattern); otherwise the rule carries its own. Mirrors the backend precedence
  // in `autoAuthMiddleware` (`instanceAccessOverride ?? rule.instanceAccess`).
  const ia = meta.instanceAccess ?? accessRule.instanceAccess;
  const objectType = qualifyResourceType(accessRule.pluginId, accessRule.resource);

  // No instance scoping, or the deliberate global opt-out: pure global-rule gate.
  if (!ia || ia.global === true) {
    return { kind: "global", accessRule, objectType, action: accessRule.level };
  }
  // Post-filtered reads/bulk writes: reachable surface, server returns the
  // caller's authorized subset. No client pre-gate.
  if (ia.listKey || ia.recordKey || ia.bulkManage) {
    return { kind: "open", accessRule, objectType, action: accessRule.level };
  }
  if (ia.idParam) {
    return {
      kind: "idParam",
      accessRule,
      objectType,
      action: accessRule.level,
      resourceId: resolvedId(input, ia.idParam),
    };
  }
  if (ia.create) {
    const parentType = ia.create.parent?.resourceType;
    return {
      kind: "create",
      accessRule,
      objectType,
      parentType,
      // A parent-gated create is also authorized by MANAGE on the parent (global
      // or team). Carry the synthetic parent-manage rule so the global path ORs
      // it in; the team side is covered by the `canCreate` query's parentType.
      parentAccessRule: parentType ? syntheticRule(parentType, "manage") : undefined,
      // A sibling-gated create is also authorized by a `creator` grant on any of
      // these types; the team side is covered by the `canCreate` query.
      alsoAcceptCreatorOf: ia.create.alsoAcceptCreatorOf,
      action: "manage",
    };
  }
  if (ia.typeScoped) {
    return {
      kind: "typeScoped",
      accessRule,
      objectType,
      action: ia.typeScoped.action ?? accessRule.level,
    };
  }
  if (ia.parentScope) {
    // Delegated to a PARENT type. This IS derivable: the parent grant string the
    // backend checks is exactly `${resourceType}.${action}`, so we reconstruct a
    // SYNTHETIC parent AccessRule (id/resource/level/pluginId are all the global
    // check reads) from the qualified parent type + action. The gate then behaves
    // like a native `idParam`/`open` gate on the parent rule + parent type.
    const ps = ia.parentScope;
    const action = ps.action ?? "read";
    const parentRule = syntheticRule(ps.resourceType, action);
    // recordKey variant is a post-filter (no single id) → open surface; idParam
    // variant is a per-parent pre-check.
    if (!ps.idParam) {
      return { kind: "open", accessRule: parentRule, objectType: ps.resourceType, action };
    }
    return {
      kind: "idParam",
      accessRule: parentRule,
      objectType: ps.resourceType,
      action,
      resourceId: resolvedId(input, ps.idParam),
    };
  }
  // Unknown/empty instanceAccess: fall back to the safe global-rule gate.
  return { kind: "global", accessRule, objectType, action: accessRule.level };
}
