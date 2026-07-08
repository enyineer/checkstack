import { createHmac } from "node:crypto";

/** Header carrying the HMAC signature of the request body. */
export const SIGNATURE_HEADER = "X-Checkstack-Signature";
/** Header carrying the signed timestamp (seconds since epoch). */
export const TIMESTAMP_HEADER = "X-Checkstack-Timestamp";

/**
 * Compute the signing headers for a webhook request when the subscriber has
 * configured a shared secret. The signature is
 * `HMAC-SHA256(secret, "<timestamp>.<body>")`, hex-encoded and prefixed with
 * `sha256=`. Binding the timestamp into the signed string lets receivers reject
 * replayed deliveries. Returns an empty object when no secret is set.
 */
export function buildSignatureHeaders({
  secret,
  rawBody,
  timestampSeconds,
}: {
  secret?: string;
  rawBody: string;
  timestampSeconds: number;
}): Record<string, string> {
  if (!secret) return {};
  const signature = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest("hex");
  return {
    [SIGNATURE_HEADER]: `sha256=${signature}`,
    [TIMESTAMP_HEADER]: String(timestampSeconds),
  };
}
