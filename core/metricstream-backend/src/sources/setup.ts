import type { Logger, RpcService } from "@checkstack/backend-api";
import type { IngestAuthenticator } from "@checkstack/ingest-utils";
import { RateLimiter } from "@checkstack/ingest-utils";
import type { PushTokenVerifier } from "@checkstack/telemetry-backend";
import type { StreamConfigResolver } from "../ingest/stream-config";
import type { MetricIngestSink } from "./ingest-sink";
import { createOtlpMetricsHandler } from "./otlp/endpoint";
import { createNativeMetricsHandler } from "./native/endpoint";

/**
 * Wire metricstream's PUSH ingest endpoints directly against the shared sink +
 * `ckms_` authenticator: OTLP/HTTP metrics (`POST /v1/metrics`) and native JSON
 * metrics (`POST /ingest`). A single pod-local soft rate limiter is shared by
 * both so a stream's per-minute budget is counted across them.
 *
 * PULL scraping used to live here (a dogfooded metric-source extension point + a
 * `metricstream-scrape` reconciler). It is GONE: Prometheus scraping is now the
 * telemetry-platform source type `metricstream.prometheus-scrape`, scheduled by
 * the platform (core reconciler) or a satellite (generic `telemetry-pull`
 * capability). See `sources/prometheus/source-type.ts`.
 */
export function registerSources({
  rpc,
  sink,
  auth,
  verifier,
  logger,
  configResolver,
}: {
  rpc: RpcService;
  sink: MetricIngestSink;
  auth: IngestAuthenticator;
  /** Platform push-token verifier - stamps the instance's last-seen on ingest. */
  verifier: PushTokenVerifier;
  logger: Logger;
  configResolver: StreamConfigResolver;
}): void {
  const pushRateLimiter = new RateLimiter();

  // Fire-and-forget last-seen stamp on every verified push (the platform
  // throttles the underlying write); a failure must never affect ingest.
  const recordPushSeen = (tokenId: string): void => {
    void verifier.recordPushSeen(tokenId).catch((error: unknown) => {
      logger.debug(
        `metricstream: recordPushSeen failed for source ${tokenId}: ${String(error)}`,
      );
    });
  };

  rpc.registerHttpHandler(
    createOtlpMetricsHandler({
      auth,
      configResolver,
      sink,
      logger,
      rateLimiter: pushRateLimiter,
      recordPushSeen,
    }),
    "/v1/metrics",
  );
  rpc.registerHttpHandler(
    createNativeMetricsHandler({
      auth,
      configResolver,
      sink,
      rateLimiter: pushRateLimiter,
      recordPushSeen,
    }),
    "/ingest",
  );

  logger.debug("metricstream: registered OTLP + native metric push handlers");
}
