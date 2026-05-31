import { createExtensionPoint } from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";
import type {
  SecretMetadata,
  SetBackendConfigInput,
  BackendConfigDto,
} from "@checkstack/secrets-common";

/** Public Vault connection metadata (never the credential). */
type VaultConfigMeta = NonNullable<BackendConfigDto["vault"]>;

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

  /**
   * Validate connectivity / auth for this backend. Returns status only and
   * NEVER a secret value. Optional — a backend that needs no external
   * connectivity (e.g. local) may omit it (treated as always-ok).
   */
  test?(): Promise<{ ok: boolean; message: string }>;

  /**
   * Persist this backend's connection config (e.g. Vault address / auth /
   * credential). Implemented by externally-configured backends; the backend
   * owns its own config storage (its plugin-scoped `ConfigService`). The
   * write-only `credential` is encrypted at rest and never returned.
   * Local-style backends omit this.
   */
  configure?(input: NonNullable<SetBackendConfigInput["vault"]>): Promise<void>;

  /**
   * Public connection metadata for the admin UI (NEVER the credential).
   * Omitted by backends with no external connection.
   */
  getConfigMeta?(): Promise<VaultConfigMeta | undefined>;
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
