/**
 * Map a content-addressed integrity (SRI, e.g. `sha512-AbC+/d==`) to a
 * safe, reversible S3 object key under a fixed prefix.
 *
 * SRI strings contain `+`, `/`, and `=`, which are legal-but-awkward in S3
 * keys (and `/` would create spurious "folders"). We hex-encode the raw
 * integrity bytes so the key is `[a-f0-9]` only, and prefix it so blobs are
 * namespaced within a shared bucket.
 */
const KEY_PREFIX = "script-packages/blobs/";

export function integrityToKey(integrity: string): string {
  const hex = Buffer.from(integrity, "utf8").toString("hex");
  return `${KEY_PREFIX}${hex}`;
}

export function keyToIntegrity(key: string): string | undefined {
  if (!key.startsWith(KEY_PREFIX)) return undefined;
  const hex = key.slice(KEY_PREFIX.length);
  if (!/^[a-f0-9]*$/.test(hex) || hex.length % 2 !== 0) return undefined;
  return Buffer.from(hex, "hex").toString("utf8");
}

export const S3_KEY_PREFIX = KEY_PREFIX;
