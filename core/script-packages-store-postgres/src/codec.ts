/**
 * Base64 codec for blob bytes stored in the `text` column.
 *
 * Kept as a separate, pure module so the round-trip is unit-testable
 * without a database.
 */

/** Bytes as they arrive at the encode boundary from any blob source. */
export type BlobBytes = Uint8Array | ArrayBuffer;

/**
 * Base64-encode blob bytes for the `text` column. Accepts a raw `ArrayBuffer`
 * (e.g. from an S3/HTTP transport) as well as a `Uint8Array`: `Buffer.from`
 * wraps an `ArrayBuffer` over the whole buffer, so we normalize to a view
 * first to encode exactly the intended bytes.
 */
export function encodeBlob(bytes: BlobBytes): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Buffer.from(view).toString("base64");
}

export function decodeBlob(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, "base64"));
}
