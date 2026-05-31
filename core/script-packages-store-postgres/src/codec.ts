/**
 * Base64 codec for blob bytes stored in the `text` column.
 *
 * Kept as a separate, pure module so the round-trip is unit-testable
 * without a database.
 */

export function encodeBlob(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function decodeBlob(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, "base64"));
}
