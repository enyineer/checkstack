import { usePluginClient } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";
import type { EnabledAuthStrategy } from "../api";

export interface UseEnabledStrategiesResult {
  strategies: EnabledAuthStrategy[];
  loading: boolean;
  error?: Error;
}

export const useEnabledStrategies = (): UseEnabledStrategiesResult => {
  const authClient = usePluginClient(AuthApi);

  const { data, isLoading, error } = authClient.getEnabledStrategies.useQuery(
    {}
  );

  return {
    strategies: (data ?? []) as EnabledAuthStrategy[],
    loading: isLoading,
    error: error ?? undefined,
  };
};
