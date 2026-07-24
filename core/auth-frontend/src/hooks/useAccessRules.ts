import { useApi, usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import { authApiRef } from "../api";

export const useAccessRules = () => {
  const authApi = useApi(authApiRef);
  const authClient = usePluginClient(AuthApi);
  const { data: session, isPending: sessionPending } = authApi.useSession();

  // Fetch the caller's EFFECTIVE access rules once the session is resolved -
  // for authenticated users their own grants, for anonymous visitors the
  // configurable "anonymous" role's grants (the `accessRules` procedure is
  // public). Gating on these makes guest UI match what a guest may actually do.
  const { data, isLoading } = authClient.accessRules.useQuery(
    {},
    {
      enabled: !sessionPending,
    }
  );

  // `isAuthenticated` lets callers additionally gate logged-in-only UI (e.g.
  // Notification Settings) that needs a real user rather than a specific rule.
  // `isInAnyTeam` gates surfaces (the Teams page/nav) that a team member or
  // manager should reach even without a global team rule.
  if (sessionPending) {
    return {
      accessRules: [],
      loading: true,
      isAuthenticated: false,
      isInAnyTeam: false,
    };
  }

  return {
    accessRules: data?.accessRules ?? [],
    loading: isLoading,
    isAuthenticated: !!session?.user,
    isInAnyTeam: data?.isInAnyTeam ?? false,
  };
};
