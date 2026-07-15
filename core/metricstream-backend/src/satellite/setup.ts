/**
 * Register metricstream's satellite capability handler against satellite-backend's
 * extension point (dependency inversion: the DOMAIN plugin CONTRIBUTES;
 * satellite-backend, the platform host, never imports metricstream).
 *
 * - "metricstream": forwarded push telemetry (token-authorized) - a satellite
 *   receiver forwards push telemetry it accepted for a stream.
 *
 * The old "metric-scrape" capability is GONE: satellite-side Prometheus scraping
 * now runs through the generic `telemetry-pull` capability (the
 * `metricstream.prometheus-scrape` telemetry source type marked
 * `supportsSatellite`). Registration is buffered behind the extension point, so
 * calling this at init (once the sink / auth / db are built) is load-order safe.
 */

import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type { IngestAuthenticator } from "@checkstack/ingest-utils";
import { pluginMetadata } from "@checkstack/metricstream-common";
import type { SatelliteCapabilityRegistry } from "@checkstack/satellite-backend";
import type { PushTokenVerifier } from "@checkstack/telemetry-backend";
import * as schema from "../schema";
import type { MetricIngestSink } from "../sources/ingest-sink";
import { createMetricstreamForwardHandler } from "./forward-capability";

export function registerSatelliteCapabilities({
  registry,
  db,
  sink,
  auth,
  verifier,
  logger,
}: {
  registry: SatelliteCapabilityRegistry;
  db: SafeDatabase<typeof schema>;
  sink: MetricIngestSink;
  auth: IngestAuthenticator;
  /** Platform push-token verifier - stamps last-seen on forwarded ingest. */
  verifier: PushTokenVerifier;
  logger: Logger;
}): void {
  const recordPushSeen = (tokenId: string): void => {
    void verifier.recordPushSeen(tokenId).catch((error: unknown) => {
      logger.debug(
        `metricstream: recordPushSeen failed for source ${tokenId}: ${String(error)}`,
      );
    });
  };
  registry.registerCapability(
    createMetricstreamForwardHandler({ db, sink, auth, recordPushSeen, logger }),
    pluginMetadata,
  );
  logger.debug("metricstream: registered satellite capability (metricstream)");
}
