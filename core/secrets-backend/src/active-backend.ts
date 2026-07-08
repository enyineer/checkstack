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

    resolveMany: async (names: string[]): Promise<Map<string, string>> => {
      const distinct = [...new Set(names)];
      const resolved = new Map<string, string>();
      if (distinct.length === 0) {
        return resolved;
      }
      // Resolve the active backend id ONCE for the whole batch. The id
      // read goes through the config store (a DB read), so doing it per
      // name — as a `resolve` loop would — is the redundant N+1 this path
      // removes. The per-name `backend.get` fetch is inherent.
      const backend = backends.get(await getActiveBackendId());
      for (const name of distinct) {
        const value = await backend.get({ name });
        if (value === undefined) {
          throw new Error(`Secret not found: ${name}`);
        }
        resolved.set(name, value);
      }
      return resolved;
    },
  };
}
