/**
 * Shared request authentication for the push ingest HTTP handlers: extract the
 * `ckms_` token from the `Authorization: Bearer` or `X-Checkstack-Token` header
 * and verify it. Returns the resolved stream + token, or a ready 401/429 Response.
 *
 * A cheap per-IP PRE-authentication limiter (see {@link PreAuthRateLimiter})
 * sheds an unauthenticated flood before it can turn every request into a DB
 * token lookup. Pod-local singleton by default (matching the pod-local design of
 * the ingest limiters); tests inject their own instance.
 */

import { PreAuthRateLimiter, type IngestAuthenticator } from "@checkstack/ingest-utils";
import { extractIngestToken } from "@checkstack/metricstream-common";
import { rateLimited, unauthorized } from "./respond";

export interface AuthenticatedSource {
  streamId: string;
  tokenId: string;
}

/**
 * Process-wide pre-auth limiter shared by every push ingest handler on this pod,
 * so failure budgets are counted per IP across all endpoints. Pod-local by
 * design (see module doc).
 */
const sharedPreAuthLimiter = new PreAuthRateLimiter();

/**
 * Best-effort client IP for the pre-auth limiter key. Mirrors the platform
 * precedent (trust the first `X-Forwarded-For` hop, then `X-Real-IP`, else a
 * constant bucket). A spoofed header only lets an attacker spread its OWN flood
 * across more buckets; the limiter's IP map is size-bounded so that cannot
 * exhaust memory.
 */
function clientIpOf(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function authenticateRequest({
  request,
  auth,
  recordPushSeen,
  preAuthLimiter = sharedPreAuthLimiter,
  now = () => new Date(),
}: {
  request: Request;
  auth: IngestAuthenticator;
  /**
   * Fire-and-forget last-seen stamp for the verified push instance (the platform
   * throttles it). `tokenId` is the source instance id for push tokens. Called
   * only on a verified ingest; a throw here must never affect the response, so
   * the caller passes a callback that swallows its own errors.
   */
  recordPushSeen?: (tokenId: string) => void;
  preAuthLimiter?: PreAuthRateLimiter;
  now?: () => Date;
}): Promise<AuthenticatedSource | Response> {
  const ip = clientIpOf(request);
  const at = now();

  const limit = preAuthLimiter.check({ ip, now: at });
  if (limit.blocked) return rateLimited(limit.retryAfterSeconds);

  const token = extractIngestToken({
    authorization: request.headers.get("authorization"),
    checkstackToken: request.headers.get("x-checkstack-token"),
  });
  if (!token) {
    preAuthLimiter.recordFailure({ ip, now: at });
    return unauthorized("missing ckms_ source token");
  }

  const verdict = await auth.verify(token);
  if (!verdict.ok) {
    preAuthLimiter.recordFailure({ ip, now: at });
    return unauthorized(unauthorizedMessage(verdict.reason));
  }
  // `resourceId` is the stream id, `tokenId` the push source instance id.
  recordPushSeen?.(verdict.tokenId);
  return { streamId: verdict.resourceId, tokenId: verdict.tokenId };
}

/**
 * Human-actionable 401 bodies. The `unknown` case explicitly covers the
 * freshly-minted-token race: negative verdicts are cached per pod for up to the
 * negative TTL, so a token minted moments ago can be rejected briefly even
 * though it is valid - the operator's correct move is to retry, not to rotate.
 * Exported for the endpoint tests.
 */
export function unauthorizedMessage(reason: "unknown" | "revoked"): string {
  if (reason === "revoked") {
    return "token has been revoked; mint a new token for this stream";
  }
  return (
    "unknown token. If this token was minted within the last minute it may " +
    "still be propagating - retry shortly. Otherwise verify the token value " +
    "and that its stream still exists."
  );
}
