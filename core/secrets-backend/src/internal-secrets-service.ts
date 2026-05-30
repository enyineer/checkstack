import { internalSecretName } from "@checkstack/secrets-common";
import type { SecretBackend } from "./secret-backend";

/**
 * Cross-plugin service for platform-internal secrets (exposed via
 * `internalSecretsRef`). These are NOT user-managed named secrets — they
 * back a specific feature (e.g. the script-package registry token, or a
 * connection's credential fields).
 *
 * Internal secrets ALWAYS live on the local (always-writable, AES-GCM)
 * backend, never the active external backend: Vault is read-through with no
 * `set`, so routing internal writes through the active backend would break
 * when Vault is selected. They are stored under a reserved name prefix so
 * the user-facing Secrets UI never shows them.
 *
 * No method returns a value to a browser — this is a backend-only service.
 */
export interface InternalSecretsService {
  /** Store / rotate an internal secret value under `namespace:key...`. */
  set(input: { parts: string[]; value: string }): Promise<void>;
  /** Resolve an internal secret value, or undefined if absent. */
  get(input: { parts: string[] }): Promise<string | undefined>;
  /** Delete an internal secret. Idempotent. */
  delete(input: { parts: string[] }): Promise<void>;
}

export function createInternalSecretsService({
  getLocalBackend,
}: {
  /** Resolve the local (always-writable) backend. Throws if unavailable. */
  getLocalBackend: () => SecretBackend;
}): InternalSecretsService {
  return {
    async set({ parts, value }) {
      const backend = getLocalBackend();
      if (!backend.set) {
        throw new Error("Local secret backend does not support writes.");
      }
      await backend.set({ name: internalSecretName(...parts), value });
    },

    async get({ parts }) {
      const backend = getLocalBackend();
      return backend.get({ name: internalSecretName(...parts) });
    },

    async delete({ parts }) {
      const backend = getLocalBackend();
      if (backend.delete) {
        await backend.delete({ name: internalSecretName(...parts) });
      }
    },
  };
}
