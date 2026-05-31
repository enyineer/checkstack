import type { SecretBackend } from "@checkstack/secrets-backend";
import type {
  SecretMetadata,
  SetBackendConfigInput,
  BackendConfigDto,
  VaultAuthMethod,
} from "@checkstack/secrets-common";
import { extractErrorMessage } from "@checkstack/common";
import {
  createVaultClient,
  type FetchLike,
  type VaultClient,
  type VaultSession,
} from "./vault-client";
import type { VaultConfigStore, StoredVaultConfig } from "./vault-config-store";
import type { VaultIndexStore } from "./index-store";
import { VAULT_SECRET_BACKEND_ID } from "./index-store";
import { createValueCache, type ValueCache } from "./cache";

type VaultMeta = NonNullable<BackendConfigDto["vault"]>;
type VaultConfigInput = NonNullable<SetBackendConfigInput["vault"]>;

/** Default read-through value cache TTL (capped lifetime for rotated values). */
const DEFAULT_VALUE_TTL_MS = 5 * 60 * 1000;

export interface VaultBackendDeps {
  indexStore: VaultIndexStore;
  configStore: VaultConfigStore;
  /** Injectable fetch (defaults to global fetch) so tests use a fake Vault. */
  fetchImpl?: FetchLike;
  /** Read-through cache TTL in ms (default 5m). */
  valueTtlMs?: number;
  /** Injectable clock for deterministic session/cache expiry in tests. */
  now?: () => number;
}

/**
 * HashiCorp Vault {@link SecretBackend}. Read-through: `get` maps a name via
 * the index to a KV v2 path/key, logs in (token / AppRole / OIDC, cached
 * until lease expiry), reads the value, and caches it with a TTL. `list`
 * returns index metadata only. `set`/`delete` are intentionally NOT
 * implemented — Vault is read-through; secrets are written in Vault and
 * indexed here via the admin index API (a separate concern).
 */
export function createVaultBackend(deps: VaultBackendDeps): SecretBackend {
  const fetchImpl: FetchLike =
    deps.fetchImpl ??
    ((url, init) =>
      fetch(url, init).then((r) => ({
        ok: r.ok,
        status: r.status,
        json: () => r.json(),
        text: () => r.text(),
      })));
  const now = deps.now ?? (() => Date.now());
  const valueCache: ValueCache = createValueCache({
    ttlMs: deps.valueTtlMs ?? DEFAULT_VALUE_TTL_MS,
    now,
  });

  // Cached client + session, rebuilt when config changes or the session
  // lease expires.
  let client: VaultClient | undefined;
  let clientConfigKey: string | undefined;
  let session: VaultSession | undefined;

  const buildClient = async (): Promise<{
    client: VaultClient;
    config: StoredVaultConfig;
  }> => {
    const config = await deps.configStore.load();
    if (!config) {
      throw new Error("Vault backend is not configured.");
    }
    // Rebuild the client (and drop the session) when config changes.
    const key = JSON.stringify({
      address: config.address,
      mount: config.mount,
      authMethod: config.authMethod,
      role: config.role,
      authMount: config.authMount,
      namespace: config.namespace,
      hasCred: config.credential !== undefined,
    });
    if (!client || clientConfigKey !== key) {
      client = createVaultClient({
        config: {
          address: config.address,
          mount: config.mount,
          authMethod: config.authMethod as VaultAuthMethod,
          role: config.role,
          authMount: config.authMount,
          namespace: config.namespace,
          credential: config.credential,
        },
        fetchImpl,
      });
      clientConfigKey = key;
      session = undefined;
    }
    return { client, config };
  };

  const ensureSession = async (c: VaultClient): Promise<VaultSession> => {
    if (session && now() < session.expiresAtMs) {
      return session;
    }
    session = await c.login();
    return session;
  };

  return {
    id: VAULT_SECRET_BACKEND_ID,

    async get({ name }): Promise<string | undefined> {
      const cached = valueCache.get(name);
      if (cached !== undefined) return cached;

      const entry = await deps.indexStore.lookup(name);
      if (!entry) return undefined;

      const { client: c } = await buildClient();
      const sess = await ensureSession(c);
      const data = await c.readKvV2({
        clientToken: sess.clientToken,
        path: entry.vaultPath,
      });
      const raw = data[entry.vaultKey];
      if (raw === undefined) {
        throw new Error(
          `Vault secret "${name}" has no key "${entry.vaultKey}" at its path.`,
        );
      }
      const value = typeof raw === "string" ? raw : JSON.stringify(raw);
      valueCache.set(name, value);
      return value;
    },

    list(): Promise<SecretMetadata[]> {
      return deps.indexStore.list();
    },

    async test(): Promise<{ ok: boolean; message: string }> {
      try {
        const { client: c } = await buildClient();
        // Force a fresh login so a bad credential is reported clearly.
        session = undefined;
        await ensureSession(c);
        return { ok: true, message: "Vault authentication succeeded." };
      } catch (error) {
        return { ok: false, message: extractErrorMessage(error) };
      }
    },

    async configure(input: VaultConfigInput): Promise<void> {
      const existing = await deps.configStore.load();
      // Omitting `credential` on update keeps the existing one.
      const credential =
        input.credential === undefined
          ? existing?.credential
          : input.credential;
      await deps.configStore.save({
        address: input.address,
        mount: input.mount,
        authMethod: input.authMethod,
        role: input.role,
        authMount: input.authMount,
        namespace: input.namespace,
        credential,
      });
      // Config changed → drop cached client/session/values.
      client = undefined;
      clientConfigKey = undefined;
      session = undefined;
      valueCache.clear();
    },

    async getConfigMeta(): Promise<VaultMeta | undefined> {
      const redacted = await deps.configStore.loadRedacted();
      if (!redacted?.address || !redacted.authMethod) return undefined;
      const full = await deps.configStore.load();
      return {
        address: redacted.address,
        mount: redacted.mount ?? "secret",
        authMethod: redacted.authMethod,
        role: redacted.role,
        authMount: redacted.authMount,
        namespace: redacted.namespace,
        hasCredential: full?.credential !== undefined,
      };
    },
  };
}
