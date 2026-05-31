import { z } from "zod";

/**
 * Vault authentication method. All three are supported:
 * - `token`: a static Vault token (the `credential`).
 * - `approle`: AppRole `role_id` (`role`) + `secret_id` (`credential`).
 * - `oidc`: OIDC/JWT login — `role` is the Vault role, `credential` is the
 *   JWT/OIDC token presented to Vault's `jwt`/`oidc` auth mount.
 */
export const vaultAuthMethodSchema = z.enum(["token", "approle", "oidc"]);
export type VaultAuthMethod = z.infer<typeof vaultAuthMethodSchema>;

/**
 * Non-secret Vault connection settings. The auth `credential` itself is
 * NEVER part of this shape — it is write-only input / encrypted at rest and
 * never returned to a browser. This is the metadata the admin UI shows.
 */
export const vaultConfigMetaSchema = z.object({
  /** Vault address, e.g. "https://vault.example.com:8200". */
  address: z.string().url(),
  /** KV v2 mount path, e.g. "secret". */
  mount: z.string().min(1).default("secret"),
  authMethod: vaultAuthMethodSchema,
  /** AppRole role_id or the OIDC/JWT Vault role name. Unused for `token`. */
  role: z.string().optional(),
  /** Auth mount path for approle/oidc (e.g. "approle", "jwt"). */
  authMount: z.string().optional(),
  /** Vault namespace (Enterprise), optional. */
  namespace: z.string().optional(),
  /** Whether an auth credential is currently stored (never the value). */
  hasCredential: z.boolean(),
});
export type VaultConfigMeta = z.infer<typeof vaultConfigMetaSchema>;

/**
 * Backend configuration as exposed to the browser: the active backend, the
 * available backend ids, and (when configured) the Vault connection
 * metadata. NEVER carries the Vault auth credential or any secret value.
 */
export const backendConfigDtoSchema = z.object({
  activeBackend: z.string(),
  availableBackends: z.array(z.string()),
  vault: vaultConfigMetaSchema.optional(),
});
export type BackendConfigDto = z.infer<typeof backendConfigDtoSchema>;

/**
 * Input for `setBackendConfig`. The Vault `credential` is write-only: it is
 * accepted here, stored encrypted, and never returned. Omit `credential` on
 * update to keep the existing one.
 */
export const setBackendConfigInputSchema = z.object({
  activeBackend: z.string().min(1),
  vault: z
    .object({
      address: z.string().url(),
      mount: z.string().min(1).default("secret"),
      authMethod: vaultAuthMethodSchema,
      role: z.string().optional(),
      authMount: z.string().optional(),
      namespace: z.string().optional(),
      /** Write-only auth credential (token / secret_id / OIDC JWT). */
      credential: z.string().optional(),
    })
    .optional(),
});
export type SetBackendConfigInput = z.infer<typeof setBackendConfigInputSchema>;

/** Result of `testBackend` — status only, never a secret value. */
export const testBackendResultSchema = z.object({
  ok: z.boolean(),
  /** Human-readable detail (auth failure reason, etc.). Never a value. */
  message: z.string(),
});
export type TestBackendResult = z.infer<typeof testBackendResultSchema>;
