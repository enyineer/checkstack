/**
 * Shared request authentication for the ingest HTTP handlers: extract the
 * `ckls_` token from the `Authorization: Bearer` or `X-Checkstack-Token` header
 * and verify it. Returns the resolved stream + token, or a ready 401 Response.
 *
 * A cheap per-IP PRE-authentication limiter (see {@link PreAuthRateLimiter})
 * sheds an unauthenticated flood before it can turn every request into a DB
 * token lookup: once an IP exceeds its auth-failure budget in the current
 * minute, further requests short-circuit to 429 without touching the DB. The
 * limiter is a per-pod, in-memory singleton by default (matching the pod-local
 * design of the ingest rate limiter); tests inject their own instance.
 */

import { extractIngestToken } from "@checkstack/logstream-common";
import type { IngestAuthenticator } from "../auth";
import { PreAuthRateLimiter } from "../rate-limit";
import { rateLimited, unauthorized } from "./respond";

export type AuthenticatedSource = { streamId: string; tokenId: string };

/**
 * Process-wide pre-auth limiter shared by every ingest handler on this pod. A
 * single instance so failure budgets are counted per IP across all endpoints,
 * not per handler. Pod-local by design (see module doc).
 */
const sharedPreAuthLimiter = new PreAuthRateLimiter();

/**
 * Best-effort client IP for the pre-auth limiter key. Mirrors the platform
 * precedent (`core/auth-backend`'s DCR rate-limit key): trust the first
 * `X-Forwarded-For` hop, then `X-Real-IP`, else a constant bucket. A spoofed
 * header only lets an attacker spread its OWN flood across more buckets; the
 * limiter's IP map is size-bounded so that cannot exhaust memory.
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
  preAuthLimiter = sharedPreAuthLimiter,
  now = () => new Date(),
}: {
  request: Request;
  auth: IngestAuthenticator;
  preAuthLimiter?: PreAuthRateLimiter;
  now?: () => Date;
}): Promise<AuthenticatedSource | Response> {
  const ip = clientIpOf(request);
  const at = now();

  // Short-circuit an IP that has already exhausted its failure budget BEFORE
  // any DB token lookup can happen.
  const limit = preAuthLimiter.check({ ip, now: at });
  if (limit.blocked) return rateLimited(limit.retryAfterSeconds);

  const token = extractIngestToken({
    authorization: request.headers.get("authorization"),
    checkstackToken: request.headers.get("x-checkstack-token"),
  });
  if (!token) {
    preAuthLimiter.recordFailure({ ip, now: at });
    return unauthorized("missing ckls_ source token");
  }

  const verdict = await auth.verify(token);
  if (!verdict.ok) {
    preAuthLimiter.recordFailure({ ip, now: at });
    return unauthorized(unauthorizedMessage(verdict.reason));
  }
  return { streamId: verdict.streamId, tokenId: verdict.tokenId };
}

/**
 * Human-actionable 401 bodies. The `unknown` case explicitly covers the
 * freshly-minted-token race: negative (unknown-token) verdicts are cached
 * per pod for up to 60 seconds, so a token minted moments ago can be
 * rejected briefly even though it is valid - the operator's correct move is
 * to retry, not to rotate the token. Exported for the endpoint tests.
 */
export function unauthorizedMessage(reason: "unknown" | "revoked"): string {
  if (reason === "revoked") {
    return "token has been revoked; mint a new token for this stream";
  }
  return (
    "unknown token. If this token was minted within the last minute it may " +
    "still be propagating - retry in up to 60 seconds. Otherwise verify the " +
    "token value and that its stream still exists."
  );
}
