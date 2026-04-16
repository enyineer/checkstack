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

  // If no session or pending, return empty access rules
  if (sessionPending) {
    return { accessRules: [], loading: true };
  }

  if (!session?.user) {
    return { accessRules: [], loading: false };
  }

  return {
    accessRules: data?.accessRules ?? [],
    loading: isLoading,
  };
};
