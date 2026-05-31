import { decrypt, isEncrypted } from "@checkstack/backend-api";
import { internalSecretName } from "@checkstack/secrets-common";
import type { InternalSecretsService } from "@checkstack/secrets-backend";

/**
 * The script-package registry auth token, consolidated onto the secrets
 * platform's internal secrets (always local-backed, AES-GCM, UI-hidden).
 *
 * The `script_package_registry_config.authSecretRef` column historically
 * held the AES-GCM ciphertext of the token directly. It now holds a
 * stable MARKER (the internal secret name) when the token lives in the
 * secrets platform. A one-time, idempotent, parity-verified migration moves
 * any legacy ciphertext into the internal store and rewrites the column to
 * the marker. Resolution falls back to decrypting legacy ciphertext until
 * the migration runs, so behavior is unchanged throughout.
 */
const TOKEN_PARTS = ["script-packages", "registry-auth-token"] as const;

/** Stable marker stored in `authSecretRef` once the token is in the platform. */
export const REGISTRY_TOKEN_MARKER = internalSecretName(...TOKEN_PARTS);

/** Whether a stored `authSecretRef` value is the platform marker. */
export function isRegistryTokenMarker(ref: string): boolean {
  return ref === REGISTRY_TOKEN_MARKER;
}

export interface RegistryTokenStore {
  /** Store / rotate the token; returns the marker to persist in the column. */
  store(token: string): Promise<string>;
  /** Clear the stored token. */
  clear(): Promise<void>;
  /**
   * Resolve the plaintext token from a stored `authSecretRef` value. Handles
   * both the platform marker (resolve via internal secrets) and legacy
   * inline ciphertext (decrypt directly). Returns undefined when absent.
   */
  resolve(ref: string | null): Promise<string | undefined>;
}

export function createRegistryTokenStore({
  internalSecrets,
}: {
  internalSecrets: InternalSecretsService;
}): RegistryTokenStore {
  return {
    async store(token) {
      await internalSecrets.set({ parts: [...TOKEN_PARTS], value: token });
      return REGISTRY_TOKEN_MARKER;
    },

    async clear() {
      await internalSecrets.delete({ parts: [...TOKEN_PARTS] });
    },

    async resolve(ref) {
      if (!ref) return;
      if (isRegistryTokenMarker(ref)) {
        return internalSecrets.get({ parts: [...TOKEN_PARTS] });
      }
      // Legacy inline ciphertext (pre-migration). Decrypt directly.
      if (isEncrypted(ref)) {
        return decrypt(ref);
      }
      return;
    },
  };
}

/**
 * One-time, idempotent migration: if `authSecretRef` holds legacy
 * ciphertext, decrypt it, store it as the internal platform secret, verify
 * the platform read-back matches, then rewrite the column to the marker.
 * Reversible: the original plaintext is recoverable from the internal
 * secret (same value), and the rewrite only happens AFTER parity is proven.
 * No-ops when already migrated (marker) or empty.
 *
 * @returns "migrated" | "already" | "empty" | "skipped" (parity failed)
 */
export async function migrateRegistryTokenToPlatform({
  currentRef,
  tokenStore,
  rewrite,
}: {
  currentRef: string | null;
  tokenStore: RegistryTokenStore;
  /** Persist the new `authSecretRef` (the marker). */
  rewrite: (marker: string) => Promise<void>;
}): Promise<"migrated" | "already" | "empty" | "skipped"> {
  if (!currentRef) return "empty";
  if (isRegistryTokenMarker(currentRef)) return "already";
  if (!isEncrypted(currentRef)) return "skipped";

  const plaintext = decrypt(currentRef);
  await tokenStore.store(plaintext);

  // Verify parity BEFORE rewriting the column (reversible guarantee: we
  // never drop the legacy ref until the platform copy reads back correctly).
  const readBack = await tokenStore.resolve(REGISTRY_TOKEN_MARKER);
  if (readBack !== plaintext) {
    return "skipped";
  }
  await rewrite(REGISTRY_TOKEN_MARKER);
  return "migrated";
}
