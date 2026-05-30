import { z } from "zod";
import { configString, type ConfigService } from "@checkstack/backend-api";
import { vaultAuthMethodSchema } from "@checkstack/secrets-common";

/**
 * Persisted backend configuration, stored via the platform `ConfigService`
 * (a single config row keyed by {@link BACKEND_CONFIG_ID}). The Vault auth
 * `credential` is marked `x-secret`, so ConfigService encrypts it at rest
 * with the AES-GCM master key (env-provided) and `getRedacted` strips it —
 * this is how we bootstrap the Vault auth secret WITHOUT putting it in
 * Vault (the chicken/egg in the plan). The credential is never returned to
 * a browser and never logged.
 */
export const BACKEND_CONFIG_ID = "backend-config";
export const BACKEND_CONFIG_VERSION = 1;

/**
 * Schema for ConfigService storage. Uses `configString({ "x-secret": true })`
 * for the credential so it is encrypted at rest + redacted on safe reads.
 */
export const storedBackendConfigSchema = z.object({
  activeBackend: z.string().default("local"),
  vault: z
    .object({
      address: z.string(),
      mount: z.string().default("secret"),
      authMethod: vaultAuthMethodSchema,
      role: z.string().optional(),
      authMount: z.string().optional(),
      namespace: z.string().optional(),
      /** Encrypted at rest; stripped by getRedacted. */
      credential: configString({ "x-secret": true }).optional(),
    })
    .optional(),
});

export type StoredBackendConfig = z.infer<typeof storedBackendConfigSchema>;

/**
 * Thin store over ConfigService for the backend config. `load` decrypts the
 * credential (service-only, for resolving against Vault); `loadRedacted`
 * omits it (safe for the frontend DTO).
 */
export interface BackendConfigStore {
  load(): Promise<StoredBackendConfig | undefined>;
  loadRedacted(): Promise<Partial<StoredBackendConfig> | undefined>;
  save(config: StoredBackendConfig): Promise<void>;
}

export function createBackendConfigStore({
  config,
}: {
  config: ConfigService;
}): BackendConfigStore {
  return {
    load: () =>
      config.get(
        BACKEND_CONFIG_ID,
        storedBackendConfigSchema,
        BACKEND_CONFIG_VERSION,
      ),
    loadRedacted: () =>
      config.getRedacted(
        BACKEND_CONFIG_ID,
        storedBackendConfigSchema,
        BACKEND_CONFIG_VERSION,
      ),
    save: (data) =>
      config.set(
        BACKEND_CONFIG_ID,
        storedBackendConfigSchema,
        BACKEND_CONFIG_VERSION,
        data,
      ),
  };
}
