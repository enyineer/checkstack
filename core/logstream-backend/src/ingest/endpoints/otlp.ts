/**
 * OTLP/HTTP logs endpoint (`POST /api/logstream/v1/logs`). Accepts
 * `application/json` and `application/x-protobuf` `ExportLogsServiceRequest`
 * bodies (optionally `Content-Encoding: gzip`) and replies with an
 * `ExportLogsServiceResponse` in the SAME content type, carrying
 * `partialSuccess` when some records were rejected.
 */

import type { Logger } from "@checkstack/backend-api";
import type { IngestPipeline } from "../pipeline";
import type { IngestAuthenticator } from "../auth";
import type { StreamConfigResolver } from "../stream-config";
import { readCappedBody, BodyTooLargeError } from "../http/body";
import {
  decodeExportLogsServiceRequest,
  encodeExportLogsServiceResponse,
  exportLogsServiceResponseJson,
  type PartialSuccess,
  normalizeOtlpPayload,
  parseOtlpJson,
} from "@checkstack/logstream-common";
import { authenticateRequest } from "./authenticate";
import {
  badRequest,
  jsonResponse,
  methodNotAllowed,
  payloadTooLarge,
  protobufResponse,
  rateLimited,
} from "./respond";

export function createOtlpLogsHandler({
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

    const config = await configResolver.resolve(source.streamId);
    const at = now();

    let payload;
    try {
      payload = isProtobuf ? decodeExportLogsServiceRequest(body) : parseOtlpJson(JSON.parse(new TextDecoder().decode(body)));
    } catch (error) {
      logger.debug(`logstream: OTLP parse failed: ${String(error)}`);
      return respond({ isProtobuf, status: 400, partial: undefined, error: "malformed OTLP body" });
    }

    const normalized = normalizeOtlpPayload({ payload, config, now: at });

    if (normalized.lines.length === 0) {
      // Nothing to ingest (empty request or all records unparseable).
      const partial =
        normalized.rejected > 0
          ? { rejectedLogRecords: normalized.rejected, errorMessage: "no valid log records" }
          : undefined;
      return respond({ isProtobuf, status: 200, partial });
    }

    const result = pipeline.ingest({
      streamId: source.streamId,
      lines: normalized.lines,
      config,
      tokenId: source.tokenId,
      now: at,
    });

    if (result.accepted === 0) {
      return rateLimited(result.retryAfterSeconds);
    }

    const rejected =
      normalized.rejected + result.rejectedRateLimit + result.rejectedBuffer;
    const partial: PartialSuccess | undefined =
      rejected > 0
        ? { rejectedLogRecords: rejected, errorMessage: "some records were dropped" }
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
  partial: PartialSuccess | undefined;
  error?: string;
}): Response {
  if (status === 400) {
    return isProtobuf
      ? protobufResponse(400, encodeExportLogsServiceResponse(partial))
      : badRequest(error ?? "bad request");
  }
  return isProtobuf
    ? protobufResponse(status, encodeExportLogsServiceResponse(partial))
    : jsonResponse(status, exportLogsServiceResponseJson(partial));
}
