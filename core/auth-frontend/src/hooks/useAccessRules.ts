import { useApi, usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import { authApiRef } from "../api";

export const useAccessRules = () => {
  const authApi = useApi(authApiRef);
  const authClient = usePluginClient(AuthApi);
  const { data: session, isPending: sessionPending } = authApi.useSession();

  // Query: Fetch access rules (only when user is authenticated)
  const { data, isLoading } = authClient.accessRules.useQuery(
    {},
    {
      enabled: !sessionPending && !!session?.user,
    }
  );

  // If no session or pending, return empty access rules. `isAuthenticated`
  // lets the sidebar gate per-user entries (e.g. Notification Settings) that
  // require a logged-in user rather than a specific access rule.
  if (sessionPending) {
    return { accessRules: [], loading: true, isAuthenticated: false };
  }

  if (!session?.user) {
    return { accessRules: [], loading: false, isAuthenticated: false };
  }

  return {
    accessRules: data?.accessRules ?? [],
    loading: isLoading,
    isAuthenticated: true,
  };
};
