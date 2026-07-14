/**
 * Webhook delivery endpoint. ONE raw HTTP handler is mounted under
 * `/api/telemetry/hooks`; it routes `POST /api/telemetry/hooks/<sourceId>` to
 * the instance's source type after verifying the per-instance secret.
 *
 * The PLATFORM owns secret verification (constant-time hash compare against the
 * stored `webhookSecretHash`); the source type's `webhook.handle` only parses
 * the delivered payload and emits normalized records through the bound sink,
 * exactly as a source token pre-authorizes the plugins' push endpoints.
 *
 * Handler errors never leak internals: a thrown handler maps to a bare 500.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Logger } from "@checkstack/backend-api";
import {
  constantTimeHexEqual,
  RateLimiter,
  type SourceTokenKit,
} from "@checkstack/ingest-utils";
import type { SourceBinding } from "@checkstack/telemetry-common";
import { createBoundSink } from "./bound-sink";
import type {
  TelemetrySinkRegistry,
  TelemetrySourceRegistry,
  WebhookSignatureDescriptor,
} from "./extension-points";

/** Path prefix (within the telemetry plugin namespace) the handler mounts at. */
export const TELEMETRY_WEBHOOK_PATH_PREFIX = "/hooks";

/** Default per-instance soft delivery budget (deliveries per minute). */
export const DEFAULT_WEBHOOK_LIMIT_PER_MINUTE = 600;

/**
 * Max bytes buffered from a webhook delivery on the SIGNATURE path before the
 * HMAC can be verified. The whole body must be read into memory to compute the
 * signature, so this cap bounds PRE-AUTH memory: an unauthenticated client
 * cannot make a pod buffer more than this before verification runs. 5 MiB
 * comfortably covers real signed webhook payloads (which are small JSON events)
 * while refusing a body built to exhaust memory ahead of the HMAC check.
 */
export const MAX_WEBHOOK_BODY_BYTES = 5 * 1024 * 1024;

/** Host-relative webhook path for a source instance. */
export function webhookPath(sourceId: string): string {
  return `/api/telemetry${TELEMETRY_WEBHOOK_PATH_PREFIX}/${sourceId}`;
}

/** The row shape the webhook handler needs to route + verify a delivery. */
export interface WebhookSourceRow {
  id: string;
  sourceTypeId: string;
  config: Record<string, unknown>;
  bindings: SourceBinding[];
  enabled: boolean;
  webhookSecretHash: string | null;
}

/** Seams the handler is built over (DB-backed in setup, faked in tests). */
export interface WebhookHandlerDeps {
  /** Load an instance by id, or null when unknown. */
  loadSource(sourceId: string): Promise<WebhookSourceRow | null>;
  sourceRegistry: TelemetrySourceRegistry;
  sinkRegistry: TelemetrySinkRegistry;
  /** Resolve a stored config's markers to plaintext and parse it for the seam. */
  resolveRunnableConfig(input: {
    sourceId: string;
    sourceTypeId: string;
    config: Record<string, unknown>;
  }): Promise<unknown>;
  /** ckwh_ token kit - used only for `hashToken` on the presented secret. */
  webhookKit: Pick<SourceTokenKit, "hashToken">;
  /**
   * Resolve a signature-verifying instance's RAW webhook secret (the HMAC key),
   * or undefined when absent. Only consulted for types whose webhook seam
   * declares a `signature` descriptor; plain-secret types never call it.
   */
  resolveWebhookSecret(sourceId: string): Promise<string | undefined>;
  /**
   * Persist the "cannot verify - no stored HMAC key" condition on the instance
   * so the frontend health hint surfaces it. Implementations MUST be
   * set-if-different (record the message without incrementing the failure
   * counter), because a mis-configured instance receives this on EVERY delivery.
   */
  markSignatureUnverifiable(input: {
    sourceId: string;
    message: string;
  }): Promise<void>;
  /** Shared pod-local soft limiter (one instance across all sources). */
  rateLimiter: RateLimiter;
  /** Per-instance delivery budget per minute. */
  limitPerMinute?: number;
  /** Signature-path body cap (bytes). Defaults to {@link MAX_WEBHOOK_BODY_BYTES}. */
  maxBodyBytes?: number;
  logger: Logger;
  now?: () => Date;
}

/**
 * Build the raw webhook HTTP handler. Register it with
 * `rpc.registerHttpHandler(handler, TELEMETRY_WEBHOOK_PATH_PREFIX)`.
 */
export function createWebhookHandler(
  deps: WebhookHandlerDeps,
): (request: Request) => Promise<Response> {
  const {
    loadSource,
    sourceRegistry,
    sinkRegistry,
    resolveRunnableConfig,
    webhookKit,
    resolveWebhookSecret,
    markSignatureUnverifiable,
    rateLimiter,
    limitPerMinute = DEFAULT_WEBHOOK_LIMIT_PER_MINUTE,
    maxBodyBytes = MAX_WEBHOOK_BODY_BYTES,
    logger,
    now = () => new Date(),
  } = deps;

  // Pod-local bookkeeping: source ids already warned+persisted for a missing
  // HMAC key, so the warn fires ONCE per source per process instead of on every
  // delivery. Purely a log/write dedupe; the durable condition lives on the row.
  const missingKeyNotified = new Set<string>();

  return async (request) => {
    if (request.method !== "POST") return status(405);

    const sourceId = extractSourceId(request.url);
    if (!sourceId) return status(404);

    const row = await loadSource(sourceId);
    if (!row || !row.enabled) return status(404);

    const type = sourceRegistry.get(row.sourceTypeId);
    if (!type) return status(404);
    if (!type.webhook) return status(405);

    // Per-instance soft rate limit (pod-local). Applied before secret
    // verification so a burst of guesses against a real instance is also shed.
    const admission = rateLimiter.admit({
      key: sourceId,
      count: 1,
      limitPerMinute,
      now: now(),
    });
    if (admission.rejected > 0) {
      return tooManyRequests(admission.retryAfterSeconds);
    }

    // Verify the delivery. A signature-declaring type verifies a vendor HMAC
    // over the (buffered) body INSTEAD of the plain secret; every other type
    // keeps the plain constant-time hash compare. `handlerRequest` is the
    // request forwarded to `handle` - re-created with the buffered body on the
    // signature path so the handler can still read it.
    let handlerRequest = request;
    const signature = type.webhook.signature;
    if (signature) {
      const key = await resolveWebhookSecret(sourceId);
      // No stored HMAC key means we cannot verify - fail closed (401). This is
      // the break-until-rotate case: a type that gained a signature descriptor
      // after this instance was created has no stored raw secret to verify
      // against, and the plaintext cannot be recovered from the hash. Surface
      // the remedy (once per source per process) so it is not silently 401ing.
      if (key === undefined) {
        if (!missingKeyNotified.has(sourceId)) {
          missingKeyNotified.add(sourceId);
          const message =
            `webhook signature verification unavailable: no stored HMAC key for ` +
            `source ${sourceId} (type ${row.sourceTypeId}). Rotate the webhook ` +
            `secret to enable signature verification.`;
          logger.warn(`telemetry: ${message}`);
          await markSignatureUnverifiable({ sourceId, message }).catch(
            (error: unknown) => {
              logger.warn(
                `telemetry: failed to persist webhook signature health for source ${sourceId}: ${String(error)}`,
              );
            },
          );
        }
        return status(401);
      }
      // Buffer the body under a hard cap BEFORE verifying: this is pre-auth, so
      // an unauthenticated client must not be able to make us buffer an
      // unbounded body. `readBodyWithCap` rejects a lying/absent content-length
      // by accumulating with a running cap, not by trusting the header.
      const body = await readBodyWithCap({ request, maxBytes: maxBodyBytes });
      if (body === null) return status(413);
      if (!verifyWebhookSignature({ signature, request, body, key, now: now() })) {
        return status(401);
      }
      handlerRequest = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        // Re-wrap as a fresh ArrayBuffer-backed view so it satisfies `BodyInit`
        // (a `Buffer.concat` result is typed over `ArrayBufferLike`).
        body: new Uint8Array(body),
      });
    } else if (
      !verifySecret({ request, hash: row.webhookSecretHash, webhookKit })
    ) {
      return status(401);
    }

    let config: unknown;
    try {
      config = await resolveRunnableConfig({
        sourceId: row.id,
        sourceTypeId: row.sourceTypeId,
        config: row.config,
      });
    } catch (error) {
      logger.warn(
        `telemetry: webhook config resolution failed for source ${sourceId}: ${String(error)}`,
      );
      return status(500);
    }

    const { sink } = createBoundSink({
      bindings: row.bindings,
      sinkRegistry,
      sourceRef: { sourceId: row.id, sourceTypeId: row.sourceTypeId },
    });

    try {
      return await type.webhook.handle({ config, sink, logger }, handlerRequest);
    } catch (error) {
      logger.warn(
        `telemetry: webhook handler threw for source ${sourceId}: ${String(error)}`,
      );
      return status(500);
    }
  };
}

/**
 * Read a request body into a Buffer under a hard byte cap, returning null when
 * the cap is exceeded (caller answers 413). Reads defensively: a declared
 * oversize `content-length` is rejected up front, and the body stream is then
 * consumed chunk-by-chunk with a running total so a LYING (too-small or absent)
 * content-length cannot smuggle an oversize body past the cap.
 *
 * We deliberately do NOT reuse `@checkstack/ingest-utils`' `readCappedBody`
 * here: it gunzips a `Content-Encoding: gzip` body (which would corrupt the
 * HMAC base string - the vendor signs the raw wire bytes) and buffers via
 * `arrayBuffer()` (which trusts the transport to stop at content-length rather
 * than capping the read itself).
 */
async function readBodyWithCap({
  request,
  maxBytes,
}: {
  request: Request;
  maxBytes: number;
}): Promise<Buffer | null> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const stream = request.body;
  if (!stream) {
    const buf = Buffer.from(await request.arrayBuffer());
    return buf.byteLength > maxBytes ? null : buf;
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Parse the trailing `<sourceId>` segment from a webhook request URL. */
export function extractSourceId(rawUrl: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    return null;
  }
  const marker = `/api/telemetry${TELEMETRY_WEBHOOK_PATH_PREFIX}/`;
  const idx = pathname.indexOf(marker);
  if (idx === -1) return null;
  const rest = pathname.slice(idx + marker.length);
  // Only a single id segment is a valid delivery target.
  if (rest.length === 0 || rest.includes("/")) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    // A malformed percent-escape (e.g. `%zz`) is not a valid id - treat it as an
    // unknown source (404) rather than letting URIError escape as a bare 500.
    return null;
  }
}

/**
 * Verify the presented secret against the stored hash in constant time.
 * Accepts `Authorization: Bearer <secret>`, `X-Checkstack-Webhook-Secret`, or a
 * `?secret=` query param (headers preferred in docs).
 */
function verifySecret({
  request,
  hash,
  webhookKit,
}: {
  request: Request;
  hash: string | null;
  webhookKit: Pick<SourceTokenKit, "hashToken">;
}): boolean {
  if (!hash) return false;
  const presented = extractSecret(request);
  if (!presented) return false;
  return constantTimeHexEqual(webhookKit.hashToken(presented), hash);
}

function extractSecret(request: Request): string | null {
  const header = request.headers.get("x-checkstack-webhook-secret");
  if (header && header.trim().length > 0) return header.trim();

  const authorization = request.headers.get("authorization");
  if (authorization) {
    const trimmed = authorization.trim();
    const scheme = /^Bearer\s+/i.exec(trimmed);
    if (scheme) {
      const candidate = trimmed.slice(scheme[0].length).trim();
      if (candidate.length > 0) return candidate;
    }
  }

  try {
    const secret = new URL(request.url).searchParams.get("secret");
    if (secret && secret.length > 0) return secret;
  } catch {
    // fall through
  }
  return null;
}

/**
 * Verify a vendor HMAC signature over a buffered delivery body against the
 * instance's raw webhook secret. Returns true ONLY when a well-formed signature
 * header is present AND the computed HMAC matches in constant time. Every
 * failure mode (missing / malformed header, stale or future timestamp, wrong
 * length, mismatch) returns false so the caller answers a bare 401.
 *
 * The compare is a byte-level {@link timingSafeEqual} over equal-length buffers
 * (the presented signature decoded per `encoding` vs. the raw HMAC digest),
 * rather than {@link constantTimeHexEqual} over hex text, so both the hex and
 * base64 encodings share one constant-time path.
 */
export function verifyWebhookSignature({
  signature,
  request,
  body,
  key,
  now,
}: {
  signature: WebhookSignatureDescriptor;
  request: Request;
  body: Buffer;
  key: string;
  now: Date;
}): boolean {
  const presentedHeader = request.headers.get(signature.header);
  if (!presentedHeader || presentedHeader.trim().length === 0) return false;

  let presented = presentedHeader.trim();
  if (signature.prefix) {
    if (!presented.startsWith(signature.prefix)) return false;
    presented = presented.slice(signature.prefix.length);
  }

  const baseInput = buildSignatureBaseInput({ signature, request, body, now });
  if (baseInput === null) return false;

  const algorithm = signature.algorithm === "hmac-sha256" ? "sha256" : "sha1";
  const computed = createHmac(algorithm, key).update(baseInput).digest();

  const presentedBytes = decodeSignature({
    value: presented,
    encoding: signature.encoding,
  });
  if (presentedBytes === null || presentedBytes.length !== computed.length) {
    return false;
  }
  return timingSafeEqual(presentedBytes, computed);
}

/**
 * Build the exact byte string the vendor signed. For "body" it is the raw body.
 * For "versioned-timestamp-body" it is `<version>:<ts>:<body>` where `version`
 * is the descriptor prefix without its trailing "=", after enforcing the replay
 * window `|now - ts| <= toleranceSeconds`. Returns null on a missing / invalid
 * timestamp, a skew violation, or a misconfigured versioned descriptor.
 */
function buildSignatureBaseInput({
  signature,
  request,
  body,
  now,
}: {
  signature: WebhookSignatureDescriptor;
  request: Request;
  body: Buffer;
  now: Date;
}): Buffer | null {
  if (signature.basestring === "body") return body;

  // versioned-timestamp-body. Registration guarantees these are present; guard
  // at run time too so a hand-built descriptor never mis-verifies silently.
  const { timestampHeader, toleranceSeconds, prefix } = signature;
  if (!timestampHeader || toleranceSeconds === undefined || !prefix) return null;

  const rawTimestamp = request.headers.get(timestampHeader);
  if (!rawTimestamp || rawTimestamp.trim().length === 0) return null;
  const timestamp = Number(rawTimestamp.trim());
  if (!Number.isFinite(timestamp)) return null;

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return null;

  const version = prefix.replace(/=$/, "");
  return Buffer.concat([
    Buffer.from(`${version}:${rawTimestamp.trim()}:`, "utf8"),
    body,
  ]);
}

/** Decode a presented signature to bytes, or null when it is not valid for the
 *  declared encoding (an odd-length / non-hex hex string, or an empty value). */
function decodeSignature({
  value,
  encoding,
}: {
  value: string;
  encoding: "hex" | "base64";
}): Buffer | null {
  if (value.length === 0) return null;
  if (encoding === "hex") {
    if (value.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(value)) return null;
    return Buffer.from(value, "hex");
  }
  return Buffer.from(value, "base64");
}

function status(code: number): Response {
  return new Response(null, { status: code });
}

/** 429 with a Retry-After header (seconds until the window resets). */
function tooManyRequests(retryAfterSeconds: number): Response {
  return new Response(null, {
    status: 429,
    headers: { "retry-after": String(Math.max(1, retryAfterSeconds)) },
  });
}
