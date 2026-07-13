/**
 * Native metrics ingest endpoint (`POST /api/metricstream/ingest`). Accepts a
 * JSON array / `{ metrics: [...] }` envelope / single object, or NDJSON
 * (`application/x-ndjson`), optionally gzipped. Replies 202 with
 * accepted/rejected counts, 429 when saturated, 400 on a wholly-malformed body.
 */

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
  rateLimited,
} from "../http/respond";
import { parseNativeMetricsBody } from "@checkstack/metricstream-common";

export function createNativeMetricsHandler({
  auth,
  configResolver,
  sink,
  rateLimiter,
  now = () => new Date(),
}: {
  auth: IngestAuthenticator;
  configResolver: StreamConfigResolver;
  sink: MetricIngestSink;
  rateLimiter: RateLimiter;
  now?: () => Date;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return methodNotAllowed();

    const source = await authenticateRequest({ request, auth });
    if (source instanceof Response) return source;

    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    const ndjson =
      contentType.includes("application/x-ndjson") ||
      contentType.includes("application/ndjson");

    let body: Uint8Array;
    try {
      body = await readCappedBody({ request });
    } catch (error) {
      if (error instanceof BodyTooLargeError) return payloadTooLarge(error.message);
      return badRequest("could not read request body");
    }

    const at = now();
    const parsed = parseNativeMetricsBody({
      text: new TextDecoder().decode(body),
      ndjson,
      now: at,
    });

    if (parsed.datapoints.length === 0) {
      return badRequest("no valid datapoints", { rejected: parsed.rejected });
    }

    const config = await configResolver.resolve(source.streamId);
    const admit = admitDatapoints({
      streamId: source.streamId,
      datapoints: parsed.datapoints,
      config,
      rateLimiter,
      now: at,
    });

    const write = sink.ingest({
      streamId: source.streamId,
      datapoints: admit.admitted,
      now: at,
    });

    if (write.accepted === 0 && (admit.rejectedRateLimit > 0 || write.rejected > 0)) {
      return rateLimited(admit.retryAfterSeconds);
    }

    const rejected =
      parsed.rejected + admit.rejectedCap + admit.rejectedRateLimit + write.rejected;
    return jsonResponse(202, { accepted: write.accepted, rejected });
  };
}
