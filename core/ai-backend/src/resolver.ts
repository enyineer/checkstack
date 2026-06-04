import type { AuthUser } from "@checkstack/backend-api";
import type { RegisteredAiTool } from "./tool-registry";
import type { AiToolRegistry } from "./tool-registry";

/**
 * Resolves the subset of registered tools a principal may see / call.
 *
 * The predicate is intentionally IDENTICAL to the global-rule check
 * `autoAuthMiddleware` applies (rpc.ts:258-260): a tool is allowed iff EVERY
 * `requiredAccessRules` entry is satisfied by the principal's `accessRules`,
 * with the `"*"` admin escape. This guarantees the resolver can never surface a
 * tool the handler would then reject for a global rule, and — crucially — can
 * never WIDEN a principal: a scope-narrowed principal carries a smaller
 * `accessRules` set, and the intersection only ever shrinks the visible tools.
 *
 * Team reach is NOT pre-filtered here. Instance (team-scoped) rules are
 * enforced per-call handler-side via the existing S2S `checkResourceTeamAccess`,
 * so the resolver filters by the access-rule VOCABULARY only and the surfaced
 * tool set matches exactly what the principal could invoke in the UI.
 */
export interface AiToolResolver {
  resolveTools(principal: AuthUser): RegisteredAiTool[];
  isAllowed(args: { principal: AuthUser; tool: RegisteredAiTool }): boolean;
}

/**
 * Pure predicate mirroring the middleware's global-rule check. Exported so
 * tests can assert it equals `autoAuthMiddleware`'s behaviour for an arbitrary
 * (rules, requiredAccessRules) matrix.
 */
export function principalSatisfiesRules({
  principalAccessRules,
  requiredAccessRules,
}: {
  principalAccessRules: readonly string[];
  requiredAccessRules: readonly string[];
}): boolean {
  return requiredAccessRules.every(
    (rule) =>
      principalAccessRules.includes("*") ||
      principalAccessRules.includes(rule),
  );
}

/**
 * Single-tool authorization gate. Services bypass the registry entirely (they
 * are trusted S2S callers and never drive the model); a service principal has
 * no access-rule set, so it is never granted a tool here.
 */
export function isToolAllowed({
  principal,
  tool,
}: {
  principal: AuthUser;
  tool: RegisteredAiTool;
}): boolean {
  const principalAccessRules =
    "accessRules" in principal ? (principal.accessRules ?? []) : [];
  return principalSatisfiesRules({
    principalAccessRules,
    requiredAccessRules: tool.requiredAccessRules,
  });
}

export function createAiToolResolver({
  registry,
}: {
  registry: AiToolRegistry;
}): AiToolResolver {
  return {
    isAllowed: isToolAllowed,
    resolveTools(principal: AuthUser): RegisteredAiTool[] {
      return registry
        .getTools()
        .filter((tool) => isToolAllowed({ principal, tool }));
    },
  };
}
