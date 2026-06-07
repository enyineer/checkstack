import { AccessApi } from "@checkstack/frontend-api";
import { useAccessRules } from "../hooks/useAccessRules";
import { isAccessRuleSatisfied, type AccessRule } from "@checkstack/common";

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

  useIsAuthenticated(): { loading: boolean; isAuthenticated: boolean } {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Class adapter delegates to hook; consumed as API, not a component
    const { loading, isAuthenticated } = useAccessRules();
    return { loading, isAuthenticated };
  }
}
