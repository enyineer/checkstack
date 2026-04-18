import { AccessApi } from "@checkstack/frontend-api";
import { useAccessRules } from "../hooks/useAccessRules";
import type { AccessRule } from "@checkstack/common";

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

    const accessRuleId = accessRule.id;

    // Check wildcard, exact match, or manage implies read
    const isWildcard = accessRules.includes("*");
    const hasExact = accessRules.includes(accessRuleId);

    // For read actions, also check if user has manage access for the same resource
    const hasManage =
      accessRule.level === "read"
        ? accessRules.includes(`${accessRule.resource}.manage`)
        : false;

    const allowed = isWildcard || hasExact || hasManage;
    return { loading: false, allowed };
  }
}
