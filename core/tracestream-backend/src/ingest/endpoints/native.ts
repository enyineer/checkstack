/**
 * Native traces ingest endpoint (`POST /api/tracestream/ingest`). Accepts
 * `application/json` carrying either a top-level array of spans or a
 * `{ "spans": [...] }` envelope (optionally gzipped). Replies 202 with
 * accepted/rejected counts, 429 when saturated, 400 on a wholly-malformed body.
 */

import type { Logger } from "@checkstack/backend-api";
import { parseNativeTraces } from "@checkstack/tracestream-common";
import {
  readCappedBody,
  BodyTooLargeError,
  type IngestAuthenticator,
} from "@checkstack/ingest-utils";
import type { IngestPipeline } from "../pipeline";
import type { StreamConfigResolver } from "../stream-config";
import { authenticateRequest } from "./authenticate";
import {
  badRequest,
  jsonResponse,
  methodNotAllowed,
  payloadTooLarge,
  rateLimited,
} from "./respond";

export function createNativeTracesHandler({
  auth,
  configResolver,
  pipeline,
  recordSeen,
  logger,
  now = () => new Date(),
}: {
  auth: IngestAuthenticator;
  configResolver: StreamConfigResolver;
  pipeline: IngestPipeline;
  /** Fire-and-forget last-seen stamp for the verified push source (`tokenId`). */
  recordSeen?: (tokenId: string) => void;
  logger: Logger;
  now?: () => Date;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return methodNotAllowed();

    const source = await authenticateRequest({ request, auth });
    if (source instanceof Response) return source;
    recordSeen?.(source.tokenId);

    let body: Uint8Array;
    try {
      body = await readCappedBody({ request });
    } catch (error) {
      if (error instanceof BodyTooLargeError) return payloadTooLarge(error.message);
      return badRequest("could not read request body");
    }

    let decoded;
    try {
      decoded = parseNativeTraces(JSON.parse(new TextDecoder().decode(body)));
    } catch (error) {
      logger.debug(`tracestream: native parse failed: ${String(error)}`);
      return badRequest("malformed JSON body");
    }

    if (decoded.spans.length === 0) {
      return badRequest("no valid spans", { rejected: decoded.rejected });
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
    return jsonResponse(202, { accepted: result.accepted, rejected });
  };
}
