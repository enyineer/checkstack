import { z } from "zod";
import type { VaultAuthMethod } from "@checkstack/secrets-common";

/**
 * Minimal, fully-typed HTTP client for HashiCorp Vault. Covers exactly what
 * this backend needs: login (token / AppRole / OIDC-JWT) and KV v2 read.
 * No external dependency — Vault's HTTP API is small and stable here, and a
 * hand-rolled client keeps the types tight (no `any`) and the surface
 * auditable (we never log tokens or values).
 *
 * `fetch` is injectable so tests run against a faithful fake with no live
 * Vault.
 */

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface VaultClientConfig {
  address: string;
  mount: string;
  authMethod: VaultAuthMethod;
  /** AppRole role_id or OIDC/JWT Vault role. */
  role?: string;
  /** Auth mount path (defaults: approle -> "approle", oidc -> "jwt"). */
  authMount?: string;
  namespace?: string;
  /** token / secret_id / OIDC JWT. */
  credential?: string;
}

/** A logged-in Vault session: client token + when it expires (epoch ms). */
export interface VaultSession {
  clientToken: string;
  /** Absolute expiry (epoch ms). Derived from the login lease TTL. */
  expiresAtMs: number;
}

// ─── Vault response schemas (validate the bits we read) ────────────────────

const loginResponseSchema = z.object({
  auth: z.object({
    client_token: z.string(),
    lease_duration: z.number().nonnegative(),
  }),
});

const kvV2ReadSchema = z.object({
  data: z.object({
    data: z.record(z.string(), z.unknown()),
  }),
});

function defaultAuthMount(method: VaultAuthMethod): string {
  switch (method) {
    case "approle": {
      return "approle";
    }
    case "oidc": {
      return "jwt";
    }
    case "token": {
      return "token";
    }
  }
}

/** Cap a session's lifetime even when Vault returns a very long TTL. */
const MAX_SESSION_MS = 60 * 60 * 1000; // 1h
/** Renew slightly before expiry to avoid using a token that just lapsed. */
const SESSION_SKEW_MS = 10_000;

/** Lease-based session expiry: honor Vault's lease_duration but cap it. */
function expiryFromLease(leaseDuration: number): number {
  return (
    Date.now() +
    Math.min(
      leaseDuration > 0 ? leaseDuration * 1000 : MAX_SESSION_MS,
      MAX_SESSION_MS,
    ) -
    SESSION_SKEW_MS
  );
}

export interface VaultClient {
  /** Authenticate and return a session (token + expiry). Throws on failure. */
  login(): Promise<VaultSession>;
  /**
   * Read a KV v2 secret's data object at `path` using `clientToken`.
   * Returns the raw `data.data` map; the caller picks the key.
   */
  readKvV2(input: {
    clientToken: string;
    path: string;
  }): Promise<Record<string, unknown>>;
}

export function createVaultClient({
  config,
  fetchImpl,
}: {
  config: VaultClientConfig;
  fetchImpl: FetchLike;
}): VaultClient {
  // Strip trailing slashes with a linear scan (a `/\/+$/` regex backtracks
  // polynomially on an address ending in many slashes - ReDoS).
  let addrEnd = config.address.length;
  while (addrEnd > 0 && config.address[addrEnd - 1] === "/") addrEnd--;
  const base = config.address.slice(0, addrEnd);
  const headers = (token?: string): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (config.namespace) h["X-Vault-Namespace"] = config.namespace;
    if (token) h["X-Vault-Token"] = token;
    return h;
  };

  const post = async (path: string, body: unknown, token?: string) => {
    const res = await fetchImpl(`${base}/v1/${path}`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `Vault request to ${path} failed with status ${res.status}`,
      );
    }
    return res.json();
  };

  return {
    async login(): Promise<VaultSession> {
      const mount = config.authMount ?? defaultAuthMount(config.authMethod);

      if (config.authMethod === "token") {
        if (!config.credential) {
          throw new Error("Vault token auth requires a token credential.");
        }
        // Validate the token via self-lookup so a bad token fails clearly.
        const res = await fetchImpl(`${base}/v1/auth/token/lookup-self`, {
          method: "GET",
          headers: headers(config.credential),
        });
        if (!res.ok) {
          throw new Error(
            `Vault token lookup failed with status ${res.status}`,
          );
        }
        return {
          clientToken: config.credential,
          // Static token: cap the cache window; Vault manages real expiry.
          expiresAtMs: Date.now() + MAX_SESSION_MS - SESSION_SKEW_MS,
        };
      }

      if (config.authMethod === "approle") {
        if (!config.role || !config.credential) {
          throw new Error(
            "Vault AppRole auth requires a role_id (role) and secret_id (credential).",
          );
        }
        const parsed = loginResponseSchema.parse(
          await post(`auth/${mount}/login`, {
            role_id: config.role,
            secret_id: config.credential,
          }),
        );
        return {
          clientToken: parsed.auth.client_token,
          expiresAtMs: expiryFromLease(parsed.auth.lease_duration),
        };
      }

      // oidc / jwt login
      if (!config.role || !config.credential) {
        throw new Error(
          "Vault OIDC/JWT auth requires a role and a JWT credential.",
        );
      }
      const parsed = loginResponseSchema.parse(
        await post(`auth/${mount}/login`, {
          role: config.role,
          jwt: config.credential,
        }),
      );
      return {
        clientToken: parsed.auth.client_token,
        expiresAtMs: expiryFromLease(parsed.auth.lease_duration),
      };
    },

    async readKvV2({ clientToken, path }): Promise<Record<string, unknown>> {
      // KV v2 reads live under <mount>/data/<path>.
      const res = await fetchImpl(
        `${base}/v1/${config.mount}/data/${path}`,
        { method: "GET", headers: headers(clientToken) },
      );
      if (res.status === 404) {
        throw new Error(`Vault secret not found at ${config.mount}/${path}`);
      }
      if (!res.ok) {
        throw new Error(
          `Vault KV read at ${path} failed with status ${res.status}`,
        );
      }
      const parsed = kvV2ReadSchema.parse(await res.json());
      return parsed.data.data;
    },
  };
}
