/**
 * Agent-local HTTP trace receivers. A shipper posts spans to the SATELLITE (OTLP
 * at `/v1/traces`, native JSON at `/ingest/traces`) exactly as it would to the
 * core ingest endpoints; the satellite parses them with the SHARED parsers, tags
 * each batch with the `cktr_` token the shipper presented, and forwards them to
 * the core telemetry client. The core "tracestream" capability handler verifies
 * the token, re-clamps the spans against its own clock and feeds its ingest
 * pipeline.
 *
 * TRUST BOUNDARY (identical to the log/metric receivers): the satellite has no
 * token DB, so it CANNOT verify the token synchronously. It only requires a
 * `cktr_`-SHAPED token (else 401) and answers once the batch is buffered. If the
 * core later rejects that token, it drops the spans terminally and logs it - the
 * shipper already got a success reply. A bad token maps to no stream, so the loss
 * is NOT charged to any stream's "dropped in transit" counter.
 *
 * Because the satellite has no per-stream config either, spans ride verbatim; the
 * core re-clamps every span's timestamps under ITS OWN clock and applies the
 * stream's caps. Both OTLP decoders (protobuf + JSON) live in the common leaf, so
 * unlike the metric receiver there is NO 415 path for OTLP JSON.
 */

import {
  BodyTooLargeError,
  chunkTelemetryBatchItems,
  encodeExportServiceResponse,
  estimateTelemetryItemBytes,
  readCappedBody,
} from "@checkstack/ingest-utils";
import {
  decodeExportTraceServiceRequest,
  exportTraceServiceResponseJson,
  extractIngestToken,
  parseNativeTraces,
  parseOtlpTracesJson,
  toWireSpan,
  type SatelliteTraceBatchItem,
} from "@checkstack/tracestream-common";
import type { NormalizedSpan } from "@checkstack/telemetry-common";
import { TRACESTREAM_TELEMETRY_KIND } from "./trace-wire";
import type { TelemetryEnqueuer } from "./enqueuer";

export { TRACESTREAM_TELEMETRY_KIND } from "./trace-wire";

/**
 * Max spans carried in ONE forwarded batch item. Spans are far fatter than log
 * lines (nested attributes / events / links), so this is a quarter of the log
 * receiver's 1000-line cap; the telemetry client then packs items into
 * credit-window batches. Keeps each item well under the frame cap.
 */
export const MAX_SPANS_PER_ITEM = 250;

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

/** Approximate the serialized bytes of one forwarded wire span. */
function wireSpanBytes(span: SatelliteTraceBatchItem["spans"][number]): number {
  // Per-span name/id overhead + payload JSON size (spans are far fatter than log
  // lines, hence a larger per-record base than the log receiver).
  let bytes = span.name.length + 128;
  if (span.attributes) bytes += JSON.stringify(span.attributes).length;
  if (span.events) bytes += JSON.stringify(span.events).length;
  if (span.links) bytes += JSON.stringify(span.links).length;
  if (span.resource) bytes += JSON.stringify(span.resource).length;
  return bytes;
}

/** Approximate the serialized bytes of one forwarded trace item. */
export function estimateTraceItemBytes(item: unknown): number {
  const typed = item as SatelliteTraceBatchItem;
  return estimateTelemetryItemBytes({
    streamToken: typed.streamToken,
    records: typed.spans,
    perRecordBytes: wireSpanBytes,
  });
}

/** Chunk parsed spans into wire batch items of at most {@link MAX_SPANS_PER_ITEM}. */
export function buildTraceBatchItems({
  streamToken,
  spans,
}: {
  streamToken: string;
  spans: NormalizedSpan[];
}): SatelliteTraceBatchItem[] {
  return chunkTelemetryBatchItems({
    streamToken,
    records: spans,
    maxPerItem: MAX_SPANS_PER_ITEM,
    toItem: ({ streamToken: token, records }) => ({
      streamToken: token,
      spans: records.map((s) => toWireSpan(s)),
    }),
  });
}

// -- small Response builders (the receiver is not the core; keep it minimal) --

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}
const unauthorized = () =>
  json(401, { error: "missing or malformed cktr_ source token" });
const methodNotAllowed = () => json(405, { error: "use POST" });
const payloadTooLarge = (message: string) => json(413, { error: message });
const badRequest = (message: string, extra?: Record<string, unknown>) =>
  json(400, { error: message, ...extra });

/**
 * Encode an OTLP `ExportTraceServiceResponse` in the request's content type
 * (JSON or protobuf), mirroring the core OTLP endpoint. Empty on full success;
 * `partialSuccess.rejectedSpans` carries the spans the parser could not decode
 * (the ONLY rejection the satellite knows - downstream drops are the core's to
 * surface).
 */
function otlpResponse({
  isProtobuf,
  status,
  rejected,
  message,
  error,
}: {
  isProtobuf: boolean;
  status: number;
  rejected: number;
  message?: string;
  error?: string;
}): Response {
  if (status === 400) {
    return isProtobuf
      ? new Response(new Uint8Array(encodeExportServiceResponse()), {
          status: 400,
          headers: { "content-type": "application/x-protobuf" },
        })
      : badRequest(error ?? "bad request");
  }
  const partial =
    rejected > 0
      ? { rejectedSpans: rejected, errorMessage: message ?? "some spans were dropped" }
      : undefined;
  if (isProtobuf) {
    const bytes = encodeExportServiceResponse(
      partial ? { rejectedItems: partial.rejectedSpans, errorMessage: partial.errorMessage } : undefined,
    );
    return new Response(new Uint8Array(bytes), {
      status,
      headers: { "content-type": "application/x-protobuf" },
    });
  }
  return json(status, exportTraceServiceResponseJson(partial));
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

/** Forward parsed spans to the telemetry client (all items share one stream token). */
function forward({
  enqueue,
  streamToken,
  spans,
}: {
  enqueue: TelemetryEnqueuer;
  streamToken: string;
  spans: NormalizedSpan[];
}): void {
  enqueue.enqueue({
    kind: TRACESTREAM_TELEMETRY_KIND,
    items: buildTraceBatchItems({ streamToken, spans }),
    estimateBytes: estimateTraceItemBytes,
    // All items in this forward share one stream token; a buffer drop is charged
    // to that stream so the core surfaces the loss on the right stream.
    groupKeyOf: () => streamToken,
  });
}

/**
 * Build the two trace HTTP handlers bound to a telemetry enqueuer. Pure over the
 * `Request` -> `Response` boundary so they are testable without a live socket.
 */
export function createTraceReceiverHandlers({
  enqueue,
  logger,
}: {
  enqueue: TelemetryEnqueuer;
  logger: Logger;
}): {
  otlpTraces: (request: Request) => Promise<Response>;
  nativeTraces: (request: Request) => Promise<Response>;
} {
  return {
    async otlpTraces(request) {
      const contentType =
        request.headers.get("content-type")?.toLowerCase() ?? "";
      const isProtobuf =
        contentType.includes("application/x-protobuf") ||
        contentType.includes("application/protobuf");

      if (request.method !== "POST") return methodNotAllowed();
      const token = tokenOf(request);
      if (!token) return unauthorized();

      const body = await readBody(request);
      if (body instanceof Response) return body;

      let decoded;
      try {
        decoded = isProtobuf
          ? decodeExportTraceServiceRequest(body)
          : parseOtlpTracesJson(JSON.parse(new TextDecoder().decode(body)));
      } catch (error) {
        logger.debug(`satellite: OTLP traces parse failed: ${String(error)}`);
        return otlpResponse({ isProtobuf, status: 400, rejected: 0, error: "malformed OTLP body" });
      }

      if (decoded.spans.length > 0) {
        forward({ enqueue, streamToken: token, spans: decoded.spans });
      }
      // The satellite accepts responsibility for the well-formed spans (buffered
      // for forward with resend); the only rejection it can report is the parser's
      // own count of spans it could not decode.
      return otlpResponse({
        isProtobuf,
        status: 200,
        rejected: decoded.rejected,
        message: decoded.rejected > 0 ? "some spans were malformed" : undefined,
      });
    },

    async nativeTraces(request) {
      if (request.method !== "POST") return methodNotAllowed();
      const token = tokenOf(request);
      if (!token) return unauthorized();

      const body = await readBody(request);
      if (body instanceof Response) return body;

      let decoded;
      try {
        decoded = parseNativeTraces(JSON.parse(new TextDecoder().decode(body)));
      } catch (error) {
        logger.debug(`satellite: native traces parse failed: ${String(error)}`);
        return badRequest("malformed JSON body");
      }

      if (decoded.spans.length === 0) {
        return badRequest("no valid spans", { rejected: decoded.rejected });
      }

      forward({ enqueue, streamToken: token, spans: decoded.spans });
      return json(202, { accepted: decoded.spans.length, rejected: decoded.rejected });
    },
  };
}
