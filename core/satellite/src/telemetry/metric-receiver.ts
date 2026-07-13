/**
 * Agent-local HTTP metric receivers. A shipper posts metrics to the SATELLITE
 * (OTLP at `/v1/metrics`, native NDJSON/JSON at `/ingest/metrics`) exactly as it
 * would to the core push endpoints; the satellite parses them with the SHARED
 * parsers, tags the batch with the `ckms_` token presented, and forwards them to
 * the telemetry client. The core "metricstream" capability handler verifies the
 * token and feeds its ingest sink.
 *
 * TRUST BOUNDARY: identical to the log receiver - the satellite has no token DB,
 * so it only requires a `ckms_`-SHAPED token (else 401) and answers 202 once
 * buffered; a token the core later rejects yields the documented "202-then-drop"
 * (counted by the telemetry client, surfaced on the stream).
 *
 * OTLP-JSON: the OTLP JSON->payload decoder currently lives in
 * `metricstream-backend` (not the common leaf), so the JSON metrics path is not
 * yet supported on the satellite; `application/json` OTLP bodies get 415 with a
 * clear message. Native JSON (`/ingest/metrics`) IS supported. See SAT-B2 report
 * (pending: move `parseOtlpMetricsJson` to `metricstream-common`).
 */

import { BodyTooLargeError, readCappedBody } from "@checkstack/ingest-utils";
import {
  decodeExportMetricsServiceRequest,
  extractIngestToken,
  normalizeOtlpMetrics,
  parseNativeMetricsBody,
  parseOtlpMetricsJson,
  type NormalizedDatapoint,
} from "@checkstack/metricstream-common";
import {
  METRICSTREAM_TELEMETRY_KIND,
  toWireDatapoint,
  type MetricstreamForwardBatch,
} from "./metric-wire";
import type { TelemetryEnqueuer } from "./enqueuer";

export { METRICSTREAM_TELEMETRY_KIND } from "./metric-wire";

/** One item of the "metricstream" forward batch (a per-token group). */
type SatelliteMetricBatchItem = MetricstreamForwardBatch[number];

/** Max datapoints carried in ONE forwarded batch item (frame-cap guard). */
export const MAX_DATAPOINTS_PER_ITEM = 2000;

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

/** Approximate the serialized bytes of one forwarded metric item. */
export function estimateMetricItemBytes(item: unknown): number {
  const typed = item as SatelliteMetricBatchItem;
  // ~48 bytes/datapoint proportional budget; avoids O(payload) JSON.stringify.
  return typed.streamToken.length + 16 + typed.datapoints.length * 48;
}

/** Chunk datapoints into wire items of at most {@link MAX_DATAPOINTS_PER_ITEM}. */
export function buildMetricBatchItems({
  streamToken,
  datapoints,
}: {
  streamToken: string;
  datapoints: NormalizedDatapoint[];
}): SatelliteMetricBatchItem[] {
  const items: SatelliteMetricBatchItem[] = [];
  for (let i = 0; i < datapoints.length; i += MAX_DATAPOINTS_PER_ITEM) {
    items.push({
      streamToken,
      datapoints: datapoints
        .slice(i, i + MAX_DATAPOINTS_PER_ITEM)
        .map((d) => toWireDatapoint(d)),
    });
  }
  return items;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}
const unauthorized = () =>
  json(401, { error: "missing or malformed ckms_ source token" });
const methodNotAllowed = () => json(405, { error: "use POST" });
const payloadTooLarge = (message: string) => json(413, { error: message });
const badRequest = (message: string) => json(400, { error: message });

async function readBody(request: Request): Promise<Uint8Array | Response> {
  try {
    return await readCappedBody({ request });
  } catch (error) {
    if (error instanceof BodyTooLargeError) return payloadTooLarge(error.message);
    return badRequest("could not read request body");
  }
}

function tokenOf(request: Request): string | null {
  return extractIngestToken({
    authorization: request.headers.get("authorization"),
    checkstackToken: request.headers.get("x-checkstack-token"),
  });
}

function forward({
  enqueue,
  streamToken,
  datapoints,
}: {
  enqueue: TelemetryEnqueuer;
  streamToken: string;
  datapoints: NormalizedDatapoint[];
}): Response {
  if (datapoints.length === 0) {
    return badRequest("no valid metric datapoints");
  }
  enqueue.enqueue({
    kind: METRICSTREAM_TELEMETRY_KIND,
    items: buildMetricBatchItems({ streamToken, datapoints }),
    estimateBytes: estimateMetricItemBytes,
    // All items in this forward share one stream token; a buffer drop is charged
    // to that stream so the core surfaces the loss on the right stream.
    groupKeyOf: () => streamToken,
  });
  return json(202, { accepted: datapoints.length });
}

/**
 * Build the two metric HTTP handlers bound to a telemetry enqueuer. Pure over
 * the `Request` -> `Response` boundary so they are testable without a socket.
 */
export function createMetricReceiverHandlers({
  enqueue,
  logger,
  now = () => new Date(),
}: {
  enqueue: TelemetryEnqueuer;
  logger: Logger;
  now?: () => Date;
}): {
  otlpMetrics: (request: Request) => Promise<Response>;
  nativeMetrics: (request: Request) => Promise<Response>;
} {
  return {
    async otlpMetrics(request) {
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

      let payload;
      try {
        payload = isProtobuf
          ? decodeExportMetricsServiceRequest(body)
          : parseOtlpMetricsJson(JSON.parse(new TextDecoder().decode(body)));
      } catch (error) {
        logger.debug(`satellite: OTLP metrics parse failed: ${String(error)}`);
        return badRequest("malformed OTLP body");
      }
      const normalized = normalizeOtlpMetrics({ payload, now: now() });
      return forward({
        enqueue,
        streamToken: token,
        datapoints: normalized.datapoints,
      });
    },

    async nativeMetrics(request) {
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

      const parsed = parseNativeMetricsBody({
        text: new TextDecoder().decode(body),
        ndjson,
        now: now(),
      });
      return forward({
        enqueue,
        streamToken: token,
        datapoints: parsed.datapoints,
      });
    },
  };
}
