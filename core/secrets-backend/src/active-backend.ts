import type { SecretBackendRegistry } from "./secret-backend-registry";
import type { SecretStore } from "./secret-resolver";

/**
 * Build a {@link SecretStore} that resolves each name through whichever
 * backend is currently active. Routing is dynamic: switching the active
 * backend (e.g. local → vault) immediately changes where values resolve
 * from, with no other plumbing change. Throws on a missing secret so a
 * required reference fails clearly.
 */
export function createActiveBackendStore({
  backends,
  getActiveBackendId,
}: {
  backends: SecretBackendRegistry;
  getActiveBackendId: () => Promise<string>;
}): SecretStore {
  return {
    resolve: async (name: string): Promise<string> => {
      const backend = backends.get(await getActiveBackendId());
      const value = await backend.get({ name });
      if (value === undefined) {
        throw new Error(`Secret not found: ${name}`);
      }
      return value;
    },
  };
}
