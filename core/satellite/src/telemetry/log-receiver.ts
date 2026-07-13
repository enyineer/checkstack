/**
 * Agent-local HTTP log receivers. A shipper posts logs to the SATELLITE (OTLP at
 * `/v1/logs`, native NDJSON/JSON at `/ingest`) exactly as it would to the core
 * ingest endpoints; the satellite parses them with the SHARED parsers, tags each
 * batch with the `ckls_` token the shipper presented, and forwards them to the
 * core telemetry client. The core capability handler (kind "logstream") verifies
 * the token and feeds its ingest pipeline.
 *
 * TRUST BOUNDARY (honest v1 semantics): the satellite has no token DB, so it
 * CANNOT verify the token synchronously. It only requires a `ckls_`-SHAPED token
 * (else 401) and answers 202 once the batch is buffered. If the core later
 * rejects that token, it drops the lines terminally and logs it - the shipper
 * already saw a 202. A bad token maps to no stream, so the loss is NOT charged
 * to any stream's "dropped in transit" counter (that counter, carried per group
 * via `droppedByGroup`, is for buffer-overflow loss on a RESOLVABLE stream).
 * This is the documented "202-then-drop for a bad token" behavior.
 *
 * Because the satellite has no per-stream config either, lines are normalized
 * with {@link DEFAULT_LOG_STREAM_CONFIG}; the core re-applies the stream's
 * `severityRules.valueMap` and re-clamps timestamps under its own clock.
 */

import {
  BodyTooLargeError,
  readCappedBody,
} from "@checkstack/ingest-utils";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  decodeExportLogsServiceRequest,
  extractIngestToken,
  normalizeOtlpPayload,
  parseNativeBody,
  parseOtlpJson,
  toWireLogLine,
  type IngestedLine,
  type SatelliteLogBatchItem,
} from "@checkstack/logstream-common";

export const LOGSTREAM_CAPABILITY_KIND = "logstream";

/**
 * Max lines carried in ONE forwarded batch item. A single HTTP request can carry
 * far more lines than fit one WS frame, so lines are split into items of this
 * size; the telemetry client then packs items into credit-window batches. Keeps
 * each item well under the ~16MB frame cap (~1KB/line -> ~1MB/item).
 */
export const MAX_LINES_PER_ITEM = 1000;

export type { TelemetryEnqueuer } from "./enqueuer";
import type { TelemetryEnqueuer } from "./enqueuer";

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

/** Approximate the heap/serialized bytes of one forwarded log item. */
export function estimateLogItemBytes(item: unknown): number {
  const typed = item as SatelliteLogBatchItem;
  // Cheap estimate: token + per-line body/attribute size. Full JSON.stringify
  // would be exact but O(payload) on every push; the telemetry buffer only needs
  // a proportional budget, so approximate from body lengths + a per-line overhead.
  let bytes = typed.streamToken.length + 16;
  for (const line of typed.lines) {
    bytes += line.body.length + 64;
    if (line.attributes) bytes += JSON.stringify(line.attributes).length;
    if (line.resource) bytes += JSON.stringify(line.resource).length;
  }
  return bytes;
}

/** Chunk parsed lines into wire batch items of at most {@link MAX_LINES_PER_ITEM}. */
export function buildLogBatchItems({
  streamToken,
  lines,
}: {
  streamToken: string;
  lines: IngestedLine[];
}): SatelliteLogBatchItem[] {
  const items: SatelliteLogBatchItem[] = [];
  for (let i = 0; i < lines.length; i += MAX_LINES_PER_ITEM) {
    items.push({
      streamToken,
      lines: lines.slice(i, i + MAX_LINES_PER_ITEM).map((l) => toWireLogLine(l)),
    });
  }
  return items;
}

// -- small Response builders (the receiver is not the core; keep it minimal) --

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}
const unauthorized = () =>
  json(401, { error: "missing or malformed ckls_ source token" });
const methodNotAllowed = () => json(405, { error: "use POST" });
const payloadTooLarge = (message: string) => json(413, { error: message });
const badRequest = (message: string) => json(400, { error: message });

/** Forward parsed lines to the telemetry client and answer 202 (or 400 if empty). */
function forward({
  enqueue,
  streamToken,
  lines,
}: {
  enqueue: TelemetryEnqueuer;
  streamToken: string;
  lines: IngestedLine[];
}): Response {
  if (lines.length === 0) {
    return badRequest("no valid log records");
  }
  enqueue.enqueue({
    kind: LOGSTREAM_CAPABILITY_KIND,
    items: buildLogBatchItems({ streamToken, lines }),
    estimateBytes: estimateLogItemBytes,
    // All items in this forward share one stream token; a buffer drop is charged
    // to that stream so the core surfaces the loss on the right stream.
    groupKeyOf: () => streamToken,
  });
  return json(202, { accepted: lines.length });
}

function tokenOf(request: Request): string | null {
  return extractIngestToken({
    authorization: request.headers.get("authorization"),
    checkstackToken: request.headers.get("x-checkstack-token"),
  });
}

/** Read + gunzip the body under the shared caps, or a ready 413/400 Response. */
async function readBody(request: Request): Promise<Uint8Array | Response> {
  try {
    return await readCappedBody({ request });
  } catch (error) {
    if (error instanceof BodyTooLargeError) return payloadTooLarge(error.message);
    return badRequest("could not read request body");
  }
}

/**
 * Build the two log HTTP handlers bound to a telemetry enqueuer. Pure over the
 * `Request` -> `Response` boundary so they are testable without a live socket.
 */
export function createLogReceiverHandlers({
  enqueue,
  logger,
  now = () => new Date(),
}: {
  enqueue: TelemetryEnqueuer;
  logger: Logger;
  now?: () => Date;
}): {
  otlpLogs: (request: Request) => Promise<Response>;
  nativeLogs: (request: Request) => Promise<Response>;
} {
  return {
    async otlpLogs(request) {
      if (request.method !== "POST") return methodNotAllowed();
      const token = tokenOf(request);
      if (!token) return unauthorized();

      const body = await readBody(request);
      if (body instanceof Response) return body;

      const contentType =
        request.headers.get("content-type")?.toLowerCase() ?? "";
      const isProtobuf =
        contentType.includes("application/x-protobuf") ||
        contentType.includes("application/protobuf");

      const at = now();
      let payload;
      try {
        payload = isProtobuf
          ? decodeExportLogsServiceRequest(body)
          : parseOtlpJson(JSON.parse(new TextDecoder().decode(body)));
      } catch (error) {
        logger.debug(`satellite: OTLP logs parse failed: ${String(error)}`);
        return badRequest("malformed OTLP body");
      }
      const normalized = normalizeOtlpPayload({
        payload,
        config: DEFAULT_LOG_STREAM_CONFIG,
        now: at,
      });
      return forward({ enqueue, streamToken: token, lines: normalized.lines });
    },

    async nativeLogs(request) {
      if (request.method !== "POST") return methodNotAllowed();
      const token = tokenOf(request);
      if (!token) return unauthorized();

      const body = await readBody(request);
      if (body instanceof Response) return body;

      const contentType =
        request.headers.get("content-type")?.toLowerCase() ?? "";
      const ndjson =
        contentType.includes("application/x-ndjson") ||
        contentType.includes("application/ndjson") ||
        contentType.includes("text/plain");

      const parsed = parseNativeBody({
        text: new TextDecoder().decode(body),
        ndjson,
        config: DEFAULT_LOG_STREAM_CONFIG,
        now: now(),
      });
      return forward({ enqueue, streamToken: token, lines: parsed.lines });
    },
  };
}
