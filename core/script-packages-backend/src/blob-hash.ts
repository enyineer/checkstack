import { createHash } from "node:crypto";
import type { ManifestEntry } from "@checkstack/script-packages-common";

/**
 * Content hashing + verification for distributed blobs.
 *
 * A package's distributable blob is our gzip-tar of its Bun cache entry, NOT
 * the upstream npm tarball — so the SRI `integrity` key (which hashes the
 * npm tarball) does NOT cover the transported bytes. To detect corruption or
 * tampering in transit (shared blob store on core, HTTP/WS on satellites) we
 * additionally carry `blobSha256` (sha-256 of the blob) on each manifest
 * entry and verify it before extracting.
 */

/** SHA-256 (hex) of a blob's bytes. */
export function blobSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Verify `bytes` against a manifest entry's `blobSha256`. Returns `ok: true`
 * when the hash matches OR the entry predates the field (backward-safe: no
 * recorded hash means nothing to verify against). Returns `ok: false` with
 * the expected/actual hashes on a mismatch so callers can error clearly and
 * refuse to materialize the blob.
 */
export function verifyBlobSha256({
  entry,
  bytes,
}: {
  entry: Pick<ManifestEntry, "blobSha256">;
  bytes: Uint8Array;
}): { ok: true } | { ok: false; expected: string; actual: string } {
  if (!entry.blobSha256) return { ok: true };
  const actual = blobSha256(bytes);
  if (actual === entry.blobSha256) return { ok: true };
  return { ok: false, expected: entry.blobSha256, actual };
}
