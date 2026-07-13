/**
 * Request-body reading with hard size caps and gzip support for HTTP ingest
 * endpoints. Enforces a compressed-body cap (default 10 MB) and, when the body
 * is `Content-Encoding: gzip`, a decompressed cap (default 50 MB) via zlib's
 * `maxOutputLength` so a zip bomb is refused before it can exhaust memory.
 */

import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);

export const MAX_COMPRESSED_BYTES = 10 * 1024 * 1024;
export const MAX_INFLATED_BYTES = 50 * 1024 * 1024;

/** Thrown when a body exceeds a size cap; the handler maps it to 413. */
export class BodyTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BodyTooLargeError";
  }
}

/**
 * Read a request body into bytes, enforcing the compressed cap and, if gzipped,
 * decompressing under the inflated cap. Throws {@link BodyTooLargeError} on
 * either overflow.
 */
export async function readCappedBody({
  request,
  maxCompressedBytes = MAX_COMPRESSED_BYTES,
  maxInflatedBytes = MAX_INFLATED_BYTES,
}: {
  request: Request;
  maxCompressedBytes?: number;
  maxInflatedBytes?: number;
}): Promise<Uint8Array> {
  // Fast reject on a declared oversize length before buffering.
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxCompressedBytes) {
    throw new BodyTooLargeError(
      `compressed body ${declared} exceeds ${maxCompressedBytes} bytes`,
    );
  }

  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > maxCompressedBytes) {
    throw new BodyTooLargeError(
      `compressed body ${raw.byteLength} exceeds ${maxCompressedBytes} bytes`,
    );
  }

  const encoding = request.headers.get("content-encoding")?.toLowerCase() ?? "";
  if (!encoding.includes("gzip")) return raw;

  try {
    // Async gunzip so a large (up to `maxInflatedBytes`) inflate runs off the
    // libuv threadpool instead of blocking the event loop. `maxOutputLength`
    // still enforces the inflated cap, preserving the same 413 semantics.
    const inflated = await gunzipAsync(raw, { maxOutputLength: maxInflatedBytes });
    return new Uint8Array(inflated);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new BodyTooLargeError(
        `decompressed body exceeds ${maxInflatedBytes} bytes`,
      );
    }
    throw error; // a genuine gunzip failure => malformed body (handler => 400)
  }
}
