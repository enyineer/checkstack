import { usePluginClient } from "@checkstack/frontend-api";
import { SecretsApi } from "@checkstack/secrets-common";

/**
 * Fetch the available secret NAMES (never values) for the `${{ secrets.* }}`
 * autocomplete in secret -> env mapping editors.
 *
 * Pass the result to `DynamicForm`'s `secretNames` prop so an
 * `x-secret-env` field offers name suggestions. Returns `[]` until loaded
 * so callers can pass it unconditionally.
 */
export function useSecretNames(): {
  secretNames: string[];
  isLoading: boolean;
} {
  const client = usePluginClient(SecretsApi);
  const query = client.listSecretNames.useQuery(undefined, {
    // Names change rarely; cache generously.
    staleTime: 60 * 1000,
  });
  return {
    secretNames: query.data ?? [],
    isLoading: query.isLoading,
  };
}
