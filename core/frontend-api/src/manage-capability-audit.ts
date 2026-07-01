import { qualifyResourceType, type AccessRule } from "@checkstack/common";
import type { FrontendPlugin, ManageCapability, PluginRoute } from "./plugin";

/**
 * Frontend/backend RLAC drift guard.
 *
 * A management surface (route or its sidebar nav entry) gated on a `manage`
 * access rule whose resource type the BACKEND team-scopes MUST declare a
 * matching `manageCapability`. Without it, the route guard and sidebar gate the
 * surface purely on the caller's GLOBAL rule, so a user who can manage the
 * resource via a TEAM grant (ReBAC) never sees it - the exact drift the
 * capability APIs exist to close.
 *
 * The set of team-scopable types is authoritative and comes from the backend
 * contracts' `instanceAccess` (see `scripts/check-manage-capabilities.ts`),
 * derived with the SAME `qualifyResourceType(pluginId, rule.resource)` the RPC
 * middleware uses to key grants - so a mismatch here is a real mismatch there.
 *
 * This module is pure (no React, no I/O) so it can run in a unit test with
 * synthetic input AND in the CI script over the real plugins + contracts.
 */

/** A single frontend/backend capability-gating inconsistency. */
export interface CapabilityGap {
  /**
   * - `missing`: a manage route on a team-scopable type declares no
   *   `manageCapability`, so team-scoped users can't reach it.
   * - `mismatch`: the declared `objectType` is not the team-scopable type the
   *   route's own manage rule resolves to.
   * - `unknown-object-type`: a declared `objectType` is not team-scoped by any
   *   backend contract (a dead gate - grants of that type are never written).
   * - `unknown-parent-type`: a declared `parentType` is not team-scoped by any
   *   backend contract.
   */
  kind:
    | "missing"
    | "mismatch"
    | "unknown-object-type"
    | "unknown-parent-type";
  pluginId: string;
  routePath: string;
  /** Whether the gap is on the route itself or its sidebar nav entry. */
  where: "route" | "nav";
  /** The team-scopable type the route's manage rule resolves to (missing/mismatch). */
  expectedType?: string;
  /** The type the `manageCapability` actually declared (mismatch/unknown-*). */
  declaredType?: string;
  message: string;
}

/** Team-scopable type for a manage rule, mirroring the RPC middleware's keying. */
function manageRuleType(rule: AccessRule): string {
  return qualifyResourceType(rule.pluginId, rule.resource);
}

function auditGate({
  pluginId,
  routePath,
  where,
  rule,
  capability,
  teamScopableTypes,
}: {
  pluginId: string;
  routePath: string;
  where: "route" | "nav";
  rule: AccessRule | undefined;
  capability: ManageCapability | undefined;
  teamScopableTypes: ReadonlySet<string>;
}): CapabilityGap[] {
  const gaps: CapabilityGap[] = [];

  // 1. A manage surface on a team-scopable type must carry a matching capability.
  if (rule && rule.level === "manage") {
    const expectedType = manageRuleType(rule);
    if (teamScopableTypes.has(expectedType)) {
      if (!capability) {
        gaps.push({
          kind: "missing",
          pluginId,
          routePath,
          where,
          expectedType,
          message: `${where} "${routePath}" is gated on the team-scopable manage rule "${rule.pluginId}.${rule.id}" (${expectedType}) but declares no manageCapability, so team-scoped users can't reach it. Add manageCapability: { objectType: <${expectedType} constant> }.`,
        });
      } else if (capability.objectType !== expectedType) {
        gaps.push({
          kind: "mismatch",
          pluginId,
          routePath,
          where,
          expectedType,
          declaredType: capability.objectType,
          message: `${where} "${routePath}" declares manageCapability.objectType "${capability.objectType}" but its manage rule resolves to the team-scopable type "${expectedType}". They must match, or the capability gate checks a type the backend never writes.`,
        });
      }
    }
  }

  // 2. Any declared capability must reference types the backend actually
  //    team-scopes (else the gate is dead - grants of that type never exist).
  if (capability) {
    if (!teamScopableTypes.has(capability.objectType)) {
      gaps.push({
        kind: "unknown-object-type",
        pluginId,
        routePath,
        where,
        declaredType: capability.objectType,
        message: `${where} "${routePath}" declares manageCapability.objectType "${capability.objectType}", which no backend contract team-scopes (no instanceAccess keys grants on it). Either the type is wrong or the backend is missing its instanceAccess.`,
      });
    }
    if (capability.parentType && !teamScopableTypes.has(capability.parentType)) {
      gaps.push({
        kind: "unknown-parent-type",
        pluginId,
        routePath,
        where,
        declaredType: capability.parentType,
        message: `${where} "${routePath}" declares manageCapability.parentType "${capability.parentType}", which no backend contract team-scopes. A parent gate only works when the parent type is itself team-scoped (e.g. via parentScope).`,
      });
    }
  }

  return gaps;
}

function auditRoute({
  pluginId,
  route,
  teamScopableTypes,
}: {
  pluginId: string;
  route: PluginRoute;
  teamScopableTypes: ReadonlySet<string>;
}): CapabilityGap[] {
  const routePath = route.route.path;
  const gaps = auditGate({
    pluginId,
    routePath,
    where: "route",
    rule: route.accessRule,
    capability: route.manageCapability,
    teamScopableTypes,
  });

  // The nav entry can OVERRIDE the gating rule/capability; audit it only when it
  // sets its own accessRule (otherwise it inherits the route's, already checked).
  const nav = route.nav;
  if (nav?.accessRule) {
    gaps.push(
      ...auditGate({
        pluginId,
        routePath,
        where: "nav",
        rule: nav.accessRule,
        // The nav inherits the route's capability unless it overrides it.
        capability: nav.manageCapability ?? route.manageCapability,
        teamScopableTypes,
      }),
    );
  }

  return gaps;
}

/**
 * Audit every registered plugin's routes/nav entries against the set of
 * backend-team-scopable resource types. Returns all gaps found (empty = clean).
 */
export function auditManageCapabilities({
  plugins,
  teamScopableTypes,
}: {
  plugins: FrontendPlugin[];
  teamScopableTypes: ReadonlySet<string>;
}): CapabilityGap[] {
  const gaps: CapabilityGap[] = [];
  for (const plugin of plugins) {
    for (const route of plugin.routes ?? []) {
      gaps.push(
        ...auditRoute({
          pluginId: plugin.metadata.pluginId,
          route,
          teamScopableTypes,
        }),
      );
    }
  }
  return gaps;
}
