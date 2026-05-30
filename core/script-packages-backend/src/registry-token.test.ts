// AES-256 master key for the legacy-ciphertext path. Set before importing
// the encryption module so encrypt()/decrypt() succeed.
process.env.ENCRYPTION_MASTER_KEY = "22".repeat(32);

import { describe, it, expect } from "bun:test";
import { encrypt } from "@checkstack/backend-api";
import { internalSecretName } from "@checkstack/secrets-common";
import type { InternalSecretsService } from "@checkstack/secrets-backend";
import {
  createRegistryTokenStore,
  migrateRegistryTokenToPlatform,
  REGISTRY_TOKEN_MARKER,
  isRegistryTokenMarker,
} from "./registry-token";

function fakeInternalSecrets(): InternalSecretsService & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    store,
    set: async ({ parts, value }) => {
      store.set(internalSecretName(...parts), value);
    },
    get: async ({ parts }) => store.get(internalSecretName(...parts)),
    delete: async ({ parts }) => {
      store.delete(internalSecretName(...parts));
    },
  };
}

describe("REGISTRY_TOKEN_MARKER", () => {
  it("is the reserved internal name for the token", () => {
    expect(REGISTRY_TOKEN_MARKER).toBe(
      internalSecretName("script-packages", "registry-auth-token"),
    );
    expect(isRegistryTokenMarker(REGISTRY_TOKEN_MARKER)).toBe(true);
    expect(isRegistryTokenMarker("iv:tag:ct")).toBe(false);
  });
});

describe("RegistryTokenStore", () => {
  it("store() persists the token and returns the marker; resolve() reads it back", async () => {
    const internal = fakeInternalSecrets();
    const tokenStore = createRegistryTokenStore({ internalSecrets: internal });

    const marker = await tokenStore.store("npm_realToken");
    expect(marker).toBe(REGISTRY_TOKEN_MARKER);
    expect(await tokenStore.resolve(marker)).toBe("npm_realToken");
  });

  it("resolve() decrypts a legacy inline ciphertext (backward-compat)", async () => {
    const internal = fakeInternalSecrets();
    const tokenStore = createRegistryTokenStore({ internalSecrets: internal });
    const legacy = encrypt("legacy_token_value");
    expect(await tokenStore.resolve(legacy)).toBe("legacy_token_value");
  });

  it("resolve() returns undefined for null / unrecognized refs", async () => {
    const internal = fakeInternalSecrets();
    const tokenStore = createRegistryTokenStore({ internalSecrets: internal });
    expect(await tokenStore.resolve(null)).toBeUndefined();
    expect(await tokenStore.resolve("not-encrypted-not-marker")).toBeUndefined();
  });

  it("clear() removes the stored token", async () => {
    const internal = fakeInternalSecrets();
    const tokenStore = createRegistryTokenStore({ internalSecrets: internal });
    await tokenStore.store("x");
    await tokenStore.clear();
    expect(await tokenStore.resolve(REGISTRY_TOKEN_MARKER)).toBeUndefined();
  });
});

describe("migrateRegistryTokenToPlatform", () => {
  it("migrates legacy ciphertext: stores it on the platform + rewrites the column to the marker (parity-verified)", async () => {
    const internal = fakeInternalSecrets();
    const tokenStore = createRegistryTokenStore({ internalSecrets: internal });
    const legacy = encrypt("token-to-migrate");

    let rewritten: string | undefined;
    const outcome = await migrateRegistryTokenToPlatform({
      currentRef: legacy,
      tokenStore,
      rewrite: async (marker) => {
        rewritten = marker;
      },
    });

    expect(outcome).toBe("migrated");
    expect(rewritten).toBe(REGISTRY_TOKEN_MARKER);
    // The platform now resolves the same plaintext.
    expect(await tokenStore.resolve(REGISTRY_TOKEN_MARKER)).toBe(
      "token-to-migrate",
    );
  });

  it("is idempotent: re-running with the marker is a no-op", async () => {
    const internal = fakeInternalSecrets();
    const tokenStore = createRegistryTokenStore({ internalSecrets: internal });
    let rewrites = 0;
    const outcome = await migrateRegistryTokenToPlatform({
      currentRef: REGISTRY_TOKEN_MARKER,
      tokenStore,
      rewrite: async () => {
        rewrites++;
      },
    });
    expect(outcome).toBe("already");
    expect(rewrites).toBe(0);
  });

  it("no-ops for an empty column", async () => {
    const internal = fakeInternalSecrets();
    const tokenStore = createRegistryTokenStore({ internalSecrets: internal });
    expect(
      await migrateRegistryTokenToPlatform({
        currentRef: null,
        tokenStore,
        rewrite: async () => {},
      }),
    ).toBe("empty");
  });
});
