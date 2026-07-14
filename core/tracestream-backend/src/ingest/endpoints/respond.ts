/**
 * Small Response builders shared by the ingest HTTP handlers. Keeps status-code
 * semantics (401 / 413 / 429 / 400 / 202) in one place.
 */

export function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  return Response.json(body, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function protobufResponse(status: number, body: Uint8Array): Response {
  // Copy into a fresh ArrayBuffer-backed view: a bare `Uint8Array` widens to
  // `ArrayBufferLike` (incl. SharedArrayBuffer), which the DOM-lib `BodyInit`
  // type under Bun rejects.
  const bytes = new Uint8Array(body);
  return new Response(bytes, {
    status,
    headers: { "content-type": "application/x-protobuf" },
  });
}

export function unauthorized(reason: string): Response {
  return jsonResponse(401, { error: `unauthorized: ${reason}` });
}

export function payloadTooLarge(message: string): Response {
  return jsonResponse(413, { error: message });
}

export function badRequest(message: string, extra?: Record<string, unknown>): Response {
  return jsonResponse(400, { error: message, ...extra });
}

export function methodNotAllowed(): Response {
  return jsonResponse(405, { error: "method not allowed; use POST" });
}

/** A 429 with a Retry-After header (seconds). */
export function rateLimited(retryAfterSeconds: number): Response {
  return jsonResponse(
    429,
    { error: "ingest buffer saturated or rate limit exceeded; retry later" },
    { "retry-after": String(Math.max(1, retryAfterSeconds)) },
  );
}
