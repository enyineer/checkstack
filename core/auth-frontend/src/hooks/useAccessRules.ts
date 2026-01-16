import { usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import { useAuthClient } from "../lib/auth-client";

export const useAccessRules = () => {
  const authBetterClient = useAuthClient();
  const authClient = usePluginClient(AuthApi);
  const { data: session, isPending: sessionPending } =
    authBetterClient.useSession();

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
