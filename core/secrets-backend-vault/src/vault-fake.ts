import type { FetchLike } from "./vault-client";

/** Build a fake HTTP response in the {@link FetchLike} shape. */
function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

/**
 * A faithful in-memory fake of the subset of Vault's HTTP API this backend
 * uses: token self-lookup, AppRole login, OIDC/JWT login, and KV v2 read.
 * Test-only helper (no live Vault). Records nothing sensitive beyond the
 * fixtures the test sets up.
 */
export interface VaultFakeOptions {
  address: string;
  mount?: string;
  /** Valid static token for token-auth self-lookup. */
  validToken?: string;
  /** AppRole credentials that succeed: role_id -> secret_id. */
  approle?: { roleId: string; secretId: string };
  /** OIDC creds that succeed: role -> jwt. */
  oidc?: { role: string; jwt: string };
  /** Client token minted by a successful approle/oidc login. */
  mintedToken?: string;
  /** lease_duration (seconds) returned by login. */
  leaseDuration?: number;
  /** KV v2 store: path -> data object. */
  kv?: Record<string, Record<string, unknown>>;
}

export function createVaultFake(options: VaultFakeOptions): {
  fetchImpl: FetchLike;
  /** Count of KV reads, to assert cache hits avoid network. */
  kvReadCount: () => number;
} {
  const mount = options.mount ?? "secret";
  const minted = options.mintedToken ?? "minted-client-token";
  const lease = options.leaseDuration ?? 3600;
  const kv = options.kv ?? {};
  let kvReads = 0;

  const fetchImpl: FetchLike = (url, init) => {
    const base = options.address.replace(/\/+$/, "");
    const path = url.replace(`${base}/v1/`, "");
    const method = init?.method ?? "GET";
    const token = init?.headers?.["X-Vault-Token"];

    // Token self-lookup
    if (path === "auth/token/lookup-self") {
      if (token && token === options.validToken) {
        return jsonResponse(200, { data: { id: token } });
      }
      return jsonResponse(403, { errors: ["permission denied"] });
    }

    // AppRole login
    if (path === "auth/approle/login" && method === "POST") {
      const body = JSON.parse(init?.body ?? "{}") as {
        role_id?: string;
        secret_id?: string;
      };
      if (
        options.approle &&
        body.role_id === options.approle.roleId &&
        body.secret_id === options.approle.secretId
      ) {
        return jsonResponse(200, {
          auth: { client_token: minted, lease_duration: lease },
        });
      }
      return jsonResponse(400, { errors: ["invalid role or secret id"] });
    }

    // OIDC / JWT login
    if (path === "auth/jwt/login" && method === "POST") {
      const body = JSON.parse(init?.body ?? "{}") as {
        role?: string;
        jwt?: string;
      };
      if (
        options.oidc &&
        body.role === options.oidc.role &&
        body.jwt === options.oidc.jwt
      ) {
        return jsonResponse(200, {
          auth: { client_token: minted, lease_duration: lease },
        });
      }
      return jsonResponse(400, { errors: ["invalid jwt"] });
    }

    // KV v2 read: <mount>/data/<path>
    const kvPrefix = `${mount}/data/`;
    if (path.startsWith(kvPrefix) && method === "GET") {
      // Only an authenticated token may read.
      const validReadToken =
        token === minted || token === options.validToken;
      if (!validReadToken) {
        return jsonResponse(403, { errors: ["permission denied"] });
      }
      const secretPath = path.slice(kvPrefix.length);
      const data = kv[secretPath];
      if (!data) {
        return jsonResponse(404, { errors: [] });
      }
      kvReads++;
      return jsonResponse(200, { data: { data } });
    }

    return jsonResponse(404, { errors: ["unsupported path"] });
  };

  return { fetchImpl, kvReadCount: () => kvReads };
}
