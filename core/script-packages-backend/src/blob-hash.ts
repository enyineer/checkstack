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

/** Bytes as they arrive at the hash boundary from any blob source. */
export type BlobBytes = Uint8Array | ArrayBuffer;

/**
 * Normalize blob bytes to a `Uint8Array` at the consume boundary.
 *
 * Blob sources differ in what view they hand back: the central resolver and
 * the Postgres codec yield a `Uint8Array`, but `Bun.S3File.arrayBuffer()` (and
 * any `Response.arrayBuffer()` transport) yields a raw `ArrayBuffer`. Node's
 * `crypto.Hash.update()` rejects a bare `ArrayBuffer`
 * ("Received an instance of ArrayBuffer"), so we wrap it in a `Uint8Array`
 * view here. A `Uint8Array` view over the same bytes hashes identically to the
 * underlying buffer, so this never changes a computed content hash.
 */
export function toUint8Array(bytes: BlobBytes): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/** SHA-256 (hex) of a blob's bytes. */
export function blobSha256(bytes: BlobBytes): string {
  return createHash("sha256").update(toUint8Array(bytes)).digest("hex");
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
  bytes: BlobBytes;
}): { ok: true } | { ok: false; expected: string; actual: string } {
  if (!entry.blobSha256) return { ok: true };
  const actual = blobSha256(bytes);
  if (actual === entry.blobSha256) return { ok: true };
  return { ok: false, expected: entry.blobSha256, actual };
}
