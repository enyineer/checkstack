import type { SecretBackend } from "./secret-backend";

/**
 * Collects every registered {@link SecretBackend} (one per backend
 * plugin) and resolves the active one by id. Mirrors the script-packages
 * blob-store registry.
 */
export interface SecretBackendRegistry {
  register(backend: SecretBackend): void;
  /** All registered backend ids (for the admin backend selector). */
  ids(): string[];
  has(id: string): boolean;
  /** Resolve a specific backend by id. Throws if not registered. */
  get(id: string): SecretBackend;
}

export function createSecretBackendRegistry(): SecretBackendRegistry {
  const backends = new Map<string, SecretBackend>();

  return {
    register(backend) {
      backends.set(backend.id, backend);
    },

    ids() {
      return [...backends.keys()];
    },

    has(id) {
      return backends.has(id);
    },

    get(id) {
      const backend = backends.get(id);
      if (!backend) {
        throw new Error(
          `Secret backend "${id}" is not registered. Available: ${
            [...backends.keys()].join(", ") || "(none)"
          }`,
        );
      }
      return backend;
    },
  };
}
