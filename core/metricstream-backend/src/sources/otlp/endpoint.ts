/**
 * OTLP/HTTP metrics endpoint (`POST /api/metricstream/v1/metrics`). Accepts
 * `application/json` and `application/x-protobuf` `ExportMetricsServiceRequest`
 * bodies (optionally `Content-Encoding: gzip`) and replies with an
 * `ExportMetricsServiceResponse` in the SAME content type, carrying
 * `partialSuccess { rejectedDataPoints }` when some datapoints were dropped
 * (unrepresentable, over the per-request cap, rate-limited, or buffer-shed).
 */

import type { Logger } from "@checkstack/backend-api";
import { readCappedBody, BodyTooLargeError, RateLimiter } from "@checkstack/ingest-utils";
import type { IngestAuthenticator } from "@checkstack/ingest-utils";
import type { MetricIngestSink } from "../extension-point";
import type { StreamConfigResolver } from "../../ingest/stream-config";
import { authenticateRequest } from "../http/authenticate";
import { admitDatapoints } from "../http/admit";
import {
  badRequest,
  jsonResponse,
  methodNotAllowed,
  payloadTooLarge,
  protobufResponse,
  rateLimited,
} from "../http/respond";
import {
  decodeExportMetricsServiceRequest,
  normalizeOtlpMetrics,
} from "@checkstack/metricstream-common";
import { parseOtlpMetricsJson } from "./json";
import {
  encodeExportMetricsServiceResponse,
  exportMetricsServiceResponseJson,
  type MetricsPartialSuccess,
} from "./response";

/**
 * Pod-local soft rate limiter shared by the OTLP + native push handlers (one per
 * pod so a stream's soft budget is counted across both endpoints). Pod-local by
 * design; tests inject their own.
 */
export function createOtlpMetricsHandler({
  auth,
  configResolver,
  sink,
  logger,
  rateLimiter,
  now = () => new Date(),
}: {
  auth: IngestAuthenticator;
  configResolver: StreamConfigResolver;
  sink: MetricIngestSink;
  logger: Logger;
  rateLimiter: RateLimiter;
  now?: () => Date;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return methodNotAllowed();

    const source = await authenticateRequest({ request, auth });
    if (source instanceof Response) return source;

    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    const isProtobuf =
      contentType.includes("application/x-protobuf") ||
      contentType.includes("application/protobuf");

    let body: Uint8Array;
    try {
      body = await readCappedBody({ request });
    } catch (error) {
      if (error instanceof BodyTooLargeError) return payloadTooLarge(error.message);
      return badRequest("could not read request body");
    }

    const at = now();
    let payload;
    try {
      payload = isProtobuf
        ? decodeExportMetricsServiceRequest(body)
        : parseOtlpMetricsJson(JSON.parse(new TextDecoder().decode(body)));
    } catch (error) {
      logger.debug(`metricstream: OTLP metrics parse failed: ${String(error)}`);
      return respond({ isProtobuf, status: 400, partial: undefined, error: "malformed OTLP body" });
    }

    const normalized = normalizeOtlpMetrics({ payload, now: at });
    if (normalized.datapoints.length === 0) {
      const partial =
        normalized.rejected > 0
          ? { rejectedDataPoints: normalized.rejected, errorMessage: "no representable datapoints" }
          : undefined;
      return respond({ isProtobuf, status: 200, partial });
    }

    const config = await configResolver.resolve(source.streamId);
    const admit = admitDatapoints({
      streamId: source.streamId,
      datapoints: normalized.datapoints,
      config,
      rateLimiter,
      now: at,
    });

    const write = sink.ingest({
      streamId: source.streamId,
      datapoints: admit.admitted,
      now: at,
    });

    const rejected =
      normalized.rejected + admit.rejectedCap + admit.rejectedRateLimit + write.rejected;

    if (write.accepted === 0 && (admit.rejectedRateLimit > 0 || write.rejected > 0)) {
      return rateLimited(admit.retryAfterSeconds);
    }

    const partial: MetricsPartialSuccess | undefined =
      rejected > 0
        ? { rejectedDataPoints: rejected, errorMessage: "some datapoints were dropped" }
        : undefined;
    return respond({ isProtobuf, status: 200, partial });
  };
}

/** Encode an OTLP response in the request's content type (JSON or protobuf). */
function respond({
  isProtobuf,
  status,
  partial,
  error,
}: {
  isProtobuf: boolean;
  status: number;
  partial: MetricsPartialSuccess | undefined;
  error?: string;
}): Response {
  if (status === 400) {
    return isProtobuf
      ? protobufResponse(400, encodeExportMetricsServiceResponse(partial))
      : badRequest(error ?? "bad request");
  }
  return isProtobuf
    ? protobufResponse(status, encodeExportMetricsServiceResponse(partial))
    : jsonResponse(status, exportMetricsServiceResponseJson(partial));
}
