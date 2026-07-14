/**
 * OTLP/HTTP traces endpoint (`POST /api/tracestream/v1/traces`). Accepts
 * `application/json` and `application/x-protobuf` `ExportTraceServiceRequest`
 * bodies (optionally `Content-Encoding: gzip`) and replies with an
 * `ExportTraceServiceResponse` in the SAME content type, carrying
 * `partialSuccess.rejectedSpans` when some spans were rejected.
 */

import type { Logger } from "@checkstack/backend-api";
import {
  decodeExportTraceServiceRequest,
  parseOtlpTracesJson,
  exportTraceServiceResponseJson,
} from "@checkstack/tracestream-common";
import {
  encodeExportServiceResponse,
  type IngestAuthenticator,
} from "@checkstack/ingest-utils";
import { readCappedBody, BodyTooLargeError } from "@checkstack/ingest-utils";
import type { IngestPipeline } from "../pipeline";
import type { StreamConfigResolver } from "../stream-config";
import { authenticateRequest } from "./authenticate";
import {
  badRequest,
  jsonResponse,
  methodNotAllowed,
  payloadTooLarge,
  protobufResponse,
  rateLimited,
} from "./respond";

export function createOtlpTracesHandler({
  auth,
  configResolver,
  pipeline,
  logger,
  now = () => new Date(),
}: {
  auth: IngestAuthenticator;
  configResolver: StreamConfigResolver;
  pipeline: IngestPipeline;
  logger: Logger;
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

    let decoded;
    try {
      decoded = isProtobuf
        ? decodeExportTraceServiceRequest(body)
        : parseOtlpTracesJson(JSON.parse(new TextDecoder().decode(body)));
    } catch (error) {
      logger.debug(`tracestream: OTLP parse failed: ${String(error)}`);
      return respond({ isProtobuf, status: 400, rejected: 0, error: "malformed OTLP body" });
    }

    if (decoded.spans.length === 0) {
      const rejected = decoded.rejected;
      return respond({ isProtobuf, status: 200, rejected, message: rejected > 0 ? "no valid spans" : undefined });
    }

    const config = await configResolver.resolve(source.streamId);
    const at = now();
    const result = pipeline.ingest({
      streamId: source.streamId,
      spans: decoded.spans,
      config,
      now: at,
    });

    if (result.accepted === 0) {
      return rateLimited(result.retryAfterSeconds);
    }

    const rejected = decoded.rejected + result.rejectedRateLimit + result.rejectedBuffer;
    return respond({
      isProtobuf,
      status: 200,
      rejected,
      message: rejected > 0 ? "some spans were dropped" : undefined,
    });
  };
}

/** Encode an OTLP response in the request's content type (JSON or protobuf). */
function respond({
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
  const partial =
    rejected > 0
      ? { rejectedSpans: rejected, errorMessage: message ?? "some spans were dropped" }
      : undefined;

  if (status === 400) {
    return isProtobuf
      ? protobufResponse(400, encodeExportServiceResponse())
      : badRequest(error ?? "bad request");
  }
  return isProtobuf
    ? protobufResponse(
        status,
        encodeExportServiceResponse(
          partial ? { rejectedItems: partial.rejectedSpans, errorMessage: partial.errorMessage } : undefined,
        ),
      )
    : jsonResponse(status, exportTraceServiceResponseJson(partial));
}
