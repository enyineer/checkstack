import { createExtensionPoint } from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";
import type { SecretMetadata } from "@checkstack/secrets-common";

/**
 * A pluggable secret store. Built-ins: `secrets-backend-local` (default,
 * AES-256-GCM in the `secrets` table) and `secrets-backend-vault` (Phase
 * 4). The active backend is config-selected; local is the default when no
 * external backend is configured.
 *
 * `list` returns metadata only and NEVER values. `get` resolves a single
 * value and is service-internal — its result must not cross to a browser.
 * Read-through backends (Vault) implement only `get`/`list`; the local
 * backend additionally implements `set`/`delete`.
 */
export interface SecretBackend {
  /** Stable backend id recorded in `secrets.backend`. */
  readonly id: string;

  /** Resolve a single secret value by name, or undefined if absent. */
  get(input: { name: string }): Promise<string | undefined>;

  /** Create or rotate a secret value. Local backend only. */
  set?(input: {
    name: string;
    value: string;
    description?: string;
    createdBy?: string;
  }): Promise<void>;

  /** Delete a secret by name. Local backend only. Idempotent. */
  delete?(input: { name: string }): Promise<void>;

  /** Metadata for every secret this backend holds. NEVER returns values. */
  list(): Promise<SecretMetadata[]>;
}

/**
 * Extension point a secret-backend plugin registers its implementation
 * with. The active backend is selected via config; the resolver resolves
 * the registered backend by id.
 */
export interface SecretBackendExtensionPoint {
  registerSecretBackend(backend: SecretBackend, metadata: PluginMetadata): void;
}

export const secretBackendExtensionPoint =
  createExtensionPoint<SecretBackendExtensionPoint>(
    "secrets.secretBackendExtensionPoint",
  );
