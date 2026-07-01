import { usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import { useAccessRules } from "./useAccessRules";

/** Stable empty reference so consumers' memo deps don't churn while loading. */
const EMPTY: readonly string[] = [];

/**
 * The resource types the current user can create or manage ANY object of via a
 * team grant (ReBAC). Powers capability-aware sidebar/nav gating: an entry with
 * a `manageCapability` is shown when its `objectType` (or `parentType`) is in
 * this set, even for a team-scoped user who holds no global manage rule. The
 * query is authenticated, so it is skipped for anonymous visitors.
 */
export const useManageableTypes = (): {
  types: readonly string[];
  loading: boolean;
} => {
  const authClient = usePluginClient(AuthApi);
  const { isAuthenticated } = useAccessRules();
  const { data, isLoading } = authClient.myManageableTypes.useQuery(
    {},
    { enabled: isAuthenticated },
  );
  return { types: data?.types ?? EMPTY, loading: isLoading };
};
