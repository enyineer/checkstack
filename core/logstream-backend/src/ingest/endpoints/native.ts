/**
 * Native ingest endpoint (`POST /api/logstream/ingest`). Accepts
 * `application/x-ndjson` (one JSON object per line) or `application/json`
 * (an array, a `{ logs: [...] }` envelope, or a single object), optionally
 * gzipped. Replies 202 with accepted/rejected counts, 429 when saturated, 400
 * on a wholly-malformed body.
 */

import type { Logger } from "@checkstack/backend-api";
import type { IngestPipeline } from "../pipeline";
import type { IngestAuthenticator } from "../auth";
import type { StreamConfigResolver } from "../stream-config";
import { readCappedBody, BodyTooLargeError } from "../http/body";
import { parseNativeBody } from "@checkstack/logstream-common";
import { authenticateRequest } from "./authenticate";
import {
  badRequest,
  jsonResponse,
  methodNotAllowed,
  payloadTooLarge,
  rateLimited,
} from "./respond";

export function createNativeIngestHandler({
  auth,
  configResolver,
  pipeline,
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
    const ndjson =
      contentType.includes("application/x-ndjson") ||
      contentType.includes("application/ndjson") ||
      contentType.includes("text/plain");

    let body: Uint8Array;
    try {
      body = await readCappedBody({ request });
    } catch (error) {
      if (error instanceof BodyTooLargeError) return payloadTooLarge(error.message);
      return badRequest("could not read request body");
    }

    const config = await configResolver.resolve(source.streamId);
    const at = now();
    const parsed = parseNativeBody({
      text: new TextDecoder().decode(body),
      ndjson,
      config,
      now: at,
    });

    if (parsed.lines.length === 0) {
      return badRequest("no valid log records", { rejected: parsed.rejected });
    }

    const result = pipeline.ingest({
      streamId: source.streamId,
      lines: parsed.lines,
      config,
      tokenId: source.tokenId,
      now: at,
    });

    if (result.accepted === 0) {
      return rateLimited(result.retryAfterSeconds);
    }

    const rejected =
      parsed.rejected + result.rejectedRateLimit + result.rejectedBuffer;
    return jsonResponse(202, { accepted: result.accepted, rejected });
  };
}
