import { z } from "zod";
import { configString, type ConfigService } from "@checkstack/backend-api";
import { vaultAuthMethodSchema } from "@checkstack/secrets-common";

/**
 * The Vault backend's own connection config, persisted via its
 * plugin-scoped `ConfigService`. The auth `credential` is `x-secret`, so
 * ConfigService encrypts it at rest with the AES-GCM master key
 * (env-provided) and `getRedacted` strips it. This is how the Vault auth
 * secret is bootstrapped WITHOUT storing it in Vault (the chicken/egg from
 * the plan): it lives encrypted in the platform config, never in Vault,
 * never returned to a browser, never logged.
 */
export const VAULT_CONFIG_ID = "vault-config";
export const VAULT_CONFIG_VERSION = 1;

export const storedVaultConfigSchema = z.object({
  address: z.string(),
  mount: z.string().default("secret"),
  authMethod: vaultAuthMethodSchema,
  role: z.string().optional(),
  authMount: z.string().optional(),
  namespace: z.string().optional(),
  /** Encrypted at rest; stripped by getRedacted. */
  credential: configString({ "x-secret": true }).optional(),
});

export type StoredVaultConfig = z.infer<typeof storedVaultConfigSchema>;

export interface VaultConfigStore {
  /** Full config incl. decrypted credential — service-only (resolve path). */
  load(): Promise<StoredVaultConfig | undefined>;
  /** Config without the credential — safe for the admin DTO. */
  loadRedacted(): Promise<Partial<StoredVaultConfig> | undefined>;
  save(config: StoredVaultConfig): Promise<void>;
}

export function createVaultConfigStore({
  config,
}: {
  config: ConfigService;
}): VaultConfigStore {
  return {
    load: () =>
      config.get(VAULT_CONFIG_ID, storedVaultConfigSchema, VAULT_CONFIG_VERSION),
    loadRedacted: () =>
      config.getRedacted(
        VAULT_CONFIG_ID,
        storedVaultConfigSchema,
        VAULT_CONFIG_VERSION,
      ),
    save: (data) =>
      config.set(
        VAULT_CONFIG_ID,
        storedVaultConfigSchema,
        VAULT_CONFIG_VERSION,
        data,
      ),
  };
}
