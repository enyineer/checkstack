import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import type { AccessRule } from "@checkstack/common";
import { isAccessRuleSatisfied, qualifyResourceType } from "@checkstack/common";
import { AuthApi } from "@checkstack/auth-common";
import type { SystemSignalsMap } from "@checkstack/catalog-common";
import {
  principalGrantedRuleIds,
  type SystemSignalsContributor,
} from "./extension-points";

/**
 * Resolves the subset of `systemIds` a non-global principal may see for a
 * resource type, applying the SAME team/instance grants the RPC middleware
 * enforces for list/record endpoints (via auth's `getAccessibleResourceIds`).
 */
export interface SystemAccessResolver {
  accessibleSystemIds(args: {
    userId: string;
    userType: "user" | "application";
    resourceType: string;
    systemIds: string[];
    action: "read" | "manage";
    hasGlobalAccess: boolean;
  }): Promise<string[]>;
}

/**
 * Build a {@link SystemAccessResolver} backed by the auth plugin's
 * `getAccessibleResourceIds` S2S query - the exact primitive the RPC middleware
 * uses to filter list/record endpoints by team grants. A plugin gets its
 * `rpcClient` from `coreServices.rpcClient` in `init`.
 */
export function createSystemAccessResolver(
  rpcClient: RpcClient,
): SystemAccessResolver {
  const authClient = rpcClient.forPlugin(AuthApi);
  return {
    accessibleSystemIds: ({
      userId,
      userType,
      resourceType,
      systemIds,
      action,
      hasGlobalAccess,
    }) =>
      authClient.getAccessibleResourceIds({
        userId,
        userType,
        resourceType,
        resourceIds: systemIds,
        action,
        hasGlobalAccess,
      }),
  };
}

/**
 * Build a {@link SystemSignalsContributor} from a GLOBAL signal reader, applying
 * the per-source access gate centrally so every source enforces it identically
 * (and the same way the matching bulk RPC does):
 *
 * - A principal holding the global rule - including trusted service principals,
 *   which {@link principalGrantedRuleIds} maps to the wildcard - sees every
 *   system the source reports.
 * - A real user / application WITHOUT the global rule sees only the systems its
 *   TEAM grants allow, via {@link SystemAccessResolver} (the same instance/team
 *   filtering the bulk RPC applies), so `system.issues` neither under- nor
 *   over-reports relative to the per-domain UI.
 * - Any other principal without the global rule (anonymous, or a service lacking
 *   the wildcard) sees nothing.
 *
 * `readSignals` MUST return problem signals for ALL systems globally; the gate
 * filters them. It is not called for a principal that can see nothing, so a
 * no-access principal triggers no query.
 */
export function createGatedSystemSignalsContributor({
  sourceId,
  accessRule,
  resolver,
  readSignals,
}: {
  sourceId: string;
  accessRule: AccessRule;
  resolver: SystemAccessResolver;
  readSignals: () => Promise<SystemSignalsMap>;
}): SystemSignalsContributor {
  const resourceType = qualifyResourceType(
    accessRule.pluginId,
    accessRule.resource,
  );
  return {
    sourceId,
    read: async ({ principal }: { principal: AuthUser }) => {
      const hasGlobalAccess = isAccessRuleSatisfied(
        principalGrantedRuleIds(principal),
        accessRule,
      );
      if (hasGlobalAccess) {
        return { accessible: true, signals: await readSignals() };
      }
      // Only real users / applications can carry per-team instance grants.
      if (principal.type !== "user" && principal.type !== "application") {
        return { accessible: false, signals: {} };
      }
      const signals = await readSignals();
      const systemIds = Object.keys(signals);
      if (systemIds.length === 0) {
        // Source is globally clear: nothing to report and nothing to hide.
        return { accessible: true, signals: {} };
      }
      const accessibleIds = new Set(
        await resolver.accessibleSystemIds({
          userId: principal.id,
          userType: principal.type,
          resourceType,
          systemIds,
          action: "read",
          hasGlobalAccess: false,
        }),
      );
      const filtered: SystemSignalsMap = {};
      for (const [systemId, sigs] of Object.entries(signals)) {
        if (accessibleIds.has(systemId)) filtered[systemId] = sigs;
      }
      // Accessible iff the principal may see at least one affected system.
      return { accessible: accessibleIds.size > 0, signals: filtered };
    },
  };
}
