import crypto from "node:crypto";
import { z } from "zod";

/**
 * AES-256-GCM at-rest encryption for secret material (plugin config secrets,
 * the local secret backend, GitOps auth tokens, ...).
 *
 * Format of an encrypted value: `iv:authTag:ciphertext`, each part base64.
 *
 * Security properties this module guarantees:
 * - **Confidentiality + integrity**: AES-256-GCM is an AEAD cipher; the 16-byte
 *   GCM auth tag is verified on every decrypt and a mismatch is a hard error
 *   (Node's `decipher.final()` throws), so tampered ciphertext never decrypts.
 * - **Unique nonce per encryption**: the 12-byte IV is drawn fresh from the
 *   CSPRNG (`crypto.randomBytes`) on every `encrypt()` call. IV reuse under the
 *   same key is catastrophic for GCM, so the IV is NEVER fixed or derived.
 * - **Full-length tag only**: decrypt rejects any value whose IV is not exactly
 *   12 bytes or whose auth tag is not exactly 16 bytes. GCM accepts shorter
 *   tags, but a short tag weakens forgery resistance, so we refuse them.
 *
 * Key rotation (non-breaking):
 * - `ENCRYPTION_MASTER_KEY` is the PRIMARY key and is used for ALL new
 *   `encrypt()` calls.
 * - `ENCRYPTION_MASTER_KEY_PREVIOUS` is an optional comma-separated, ordered
 *   list of PREVIOUS hex keys. `decrypt()` trial-decrypts with the primary key
 *   first, then each previous key in order, and only raises {@link DecryptionError}
 *   when ALL configured keys fail to authenticate. The ciphertext format is
 *   unchanged, so there is no key-id prefix and old single-key values keep
 *   working untouched. After adding a new primary and demoting the old key to
 *   the previous list, run the re-encrypt script (see
 *   `core/backend/scripts/reencrypt-secrets.ts`) to migrate stored values onto
 *   the new primary, then drop the old key from the previous list.
 */

/** AES-256-GCM nonce length in bytes (the recommended 96-bit IV). */
const IV_LENGTH = 12;
/** Full-length GCM authentication tag in bytes (128-bit). */
const AUTH_TAG_LENGTH = 16;
/** AES-256 key length in bytes. */
const KEY_LENGTH = 32;

/**
 * Typed error raised when a value cannot be decrypted with ANY configured key
 * (primary or previous), or when the value is structurally malformed. Callers
 * surface this to operators so a broken secret fails closed instead of silently
 * substituting unusable ciphertext for the plaintext.
 *
 * The error message NEVER contains key material, the ciphertext, or the
 * plaintext - only structural context safe to log.
 */
export class DecryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DecryptionError";
  }
}

/**
 * Zod schema for a single AES-256 master key: exactly 64 lowercase-or-uppercase
 * hex characters (32 bytes). Validating with zod keeps env parsing typed and
 * gives a clear message; the value itself is NEVER logged.
 */
const hexKeySchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{64}$/, "must be 32 bytes (64 hex characters)");

/**
 * Parse and validate a hex key string into a 32-byte Buffer. Throws a plain
 * `Error` (no key material in the message) on a bad key.
 */
const parseHexKey = ({ value, label }: { value: string; label: string }): Buffer => {
  const result = hexKeySchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} ${result.error.issues[0]?.message ?? "is invalid"}`);
  }
  const keyBuffer = Buffer.from(result.data, "hex");
  // Regex already guarantees 32 bytes, but assert to be defensive.
  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(`${label} must be 32 bytes (64 hex characters)`);
  }
  return keyBuffer;
};

/**
 * Primary encryption key from `ENCRYPTION_MASTER_KEY`.
 *
 * This is a pre-generated 256-bit key supplied as 64 hex chars; it is used
 * directly as the AES-256 key (no KDF - there is no user passphrase to stretch,
 * and per-record uniqueness is provided by the random IV, not by a salt). The
 * key is read fresh on each call and never logged.
 */
const getPrimaryKey = (): Buffer => {
  const key = process.env.ENCRYPTION_MASTER_KEY;
  if (!key) {
    throw new Error(
      "ENCRYPTION_MASTER_KEY environment variable is required for secret encryption"
    );
  }
  return parseHexKey({ value: key, label: "ENCRYPTION_MASTER_KEY" });
};

/**
 * Optional ordered list of PREVIOUS keys from `ENCRYPTION_MASTER_KEY_PREVIOUS`
 * (comma-separated hex keys). Empty entries (e.g. a trailing comma) are ignored.
 * Each entry is validated; an invalid previous key is a hard error so rotation
 * misconfiguration surfaces immediately instead of silently dropping a key that
 * still has live ciphertext.
 */
const getPreviousKeys = (): Buffer[] => {
  const raw = process.env.ENCRYPTION_MASTER_KEY_PREVIOUS;
  if (!raw || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part, index) =>
      parseHexKey({
        value: part,
        label: `ENCRYPTION_MASTER_KEY_PREVIOUS[${index}]`,
      })
    );
};

/**
 * All keys to try on decrypt, in trial order: primary first, then each previous
 * key. New encryption always uses the primary (index 0).
 */
const getDecryptionKeys = (): Buffer[] => [getPrimaryKey(), ...getPreviousKeys()];

/**
 * Encrypts a plaintext string using AES-256-GCM with the PRIMARY key.
 * Returns base64-encoded string in format: iv:authTag:ciphertext
 */
export const encrypt = (plaintext: string): string => {
  const key = getPrimaryKey();

  // Fresh CSPRNG nonce per call - IV reuse under the same key breaks GCM.
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString(
    "base64"
  )}:${encrypted.toString("base64")}`;
};

/**
 * Parse and structurally validate an `iv:authTag:ciphertext` value into its
 * decoded parts. Throws {@link DecryptionError} on any malformed input (wrong
 * part count, wrong IV/tag length). Key-independent, so it runs once per
 * `decrypt()` regardless of how many keys are tried.
 */
const parseEncrypted = (
  encrypted: string
): { iv: Buffer; authTag: Buffer; ciphertext: Buffer } => {
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new DecryptionError("Invalid encrypted format");
  }

  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");

  // Reject malformed IV / tag lengths up front. A short GCM tag is weaker
  // against forgery, so we only accept the full 16-byte tag and 12-byte IV.
  if (iv.length !== IV_LENGTH) {
    throw new DecryptionError("Invalid encrypted format: IV length");
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new DecryptionError("Invalid encrypted format: auth tag length");
  }

  return { iv, authTag, ciphertext };
};

/**
 * Attempt to decrypt with a single key. Returns the plaintext on success or
 * `undefined` if the GCM tag does not verify for this key (wrong key). Any
 * non-auth failure is rethrown.
 */
const tryDecryptWithKey = ({
  key,
  iv,
  authTag,
  ciphertext,
}: {
  key: Buffer;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}): string | undefined => {
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);
    // decipher.final() throws if the GCM tag does not verify (wrong key).
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    // Auth failure for this key - signal "try the next key".
    return undefined;
  }
};

/**
 * Decrypts an encrypted string.
 * Expects base64-encoded format: iv:authTag:ciphertext
 *
 * Trial-decrypts with the PRIMARY key first, then each PREVIOUS key in order.
 * Throws {@link DecryptionError} on malformed input and only when EVERY
 * configured key fails to authenticate (tampered ciphertext or no key matches).
 * Decryption failure is ALWAYS a hard, typed error - never a silent fallthrough.
 */
export const decrypt = (encrypted: string): string => {
  const { iv, authTag, ciphertext } = parseEncrypted(encrypted);
  const keys = getDecryptionKeys();

  for (const key of keys) {
    const plaintext = tryDecryptWithKey({ key, iv, authTag, ciphertext });
    if (plaintext !== undefined) return plaintext;
  }

  // All configured keys failed to authenticate. Do NOT leak the ciphertext.
  throw new DecryptionError(
    keys.length > 1
      ? "Decryption failed: authentication failed for all configured keys (primary and previous)"
      : "Decryption failed: authentication failed (wrong key or tampered ciphertext)"
  );
};

/**
 * Checks if a value appears to be an `iv:authTag:ciphertext` value produced by
 * `encrypt()`.
 *
 * This is intentionally strict: it requires three base64 parts AND that the
 * decoded IV / auth-tag have the exact GCM lengths. A loose check (matching any
 * `base64:base64:base64`) risks treating a plaintext secret that merely
 * resembles the shape (e.g. a colon-delimited token) as already-encrypted,
 * which would cause `ConfigService` to STORE IT IN PLAINTEXT (it skips
 * encryption for values that already look encrypted). Requiring the structural
 * lengths makes that collision practically impossible.
 */
export const isEncrypted = (value: string): boolean => {
  const parts = value.split(":");
  if (parts.length !== 3) return false;

  // Each part must be non-empty, valid (standard) base64.
  const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!parts.every((part) => part.length > 0 && base64Regex.test(part))) {
    return false;
  }

  // Structural lengths must match what encrypt() produces. Buffer.from with
  // base64 silently drops invalid trailing bytes, so re-encoding and comparing
  // also rejects strings that pass the regex but aren't canonical base64.
  try {
    const iv = Buffer.from(parts[0], "base64");
    const authTag = Buffer.from(parts[1], "base64");
    const ciphertext = Buffer.from(parts[2], "base64");
    return (
      iv.length === IV_LENGTH &&
      authTag.length === AUTH_TAG_LENGTH &&
      ciphertext.length > 0
    );
  } catch {
    return false;
  }
};
