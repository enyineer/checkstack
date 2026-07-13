/**
 * Register metricstream's two satellite capability handlers against
 * satellite-backend's extension point (dependency inversion: the DOMAIN plugin
 * CONTRIBUTES; satellite-backend, the platform host, never imports metricstream).
 *
 * - "metricstream": forwarded push telemetry (token-authorized).
 * - "metric-scrape": satellite-side scraping (binding-authorized), plus the
 *   `buildCapabilityConfig` that tells a satellite which targets to scrape and
 *   the `handleCapabilityStatus` that mirrors per-target scrape health.
 *
 * Registration is buffered behind the extension point, so calling this at init
 * time (once the sink / auth / db are built) is load-order safe.
 */

import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import type { IngestAuthenticator } from "@checkstack/ingest-utils";
import type {
  InternalSecretsService,
  SecretResolverService,
} from "@checkstack/secrets-backend";
import { pluginMetadata } from "@checkstack/metricstream-common";
import type { SatelliteCapabilityRegistry } from "@checkstack/satellite-backend";
import * as schema from "../schema";
import type { ImportantEventRecorder } from "../events/recorder";
import type { MetricIngestSink } from "../sources/extension-point";
import { createMetricScrapeCapabilityHandler } from "./scrape-capability";
import { createMetricstreamForwardHandler } from "./forward-capability";

export function registerSatelliteCapabilities({
  registry,
  db,
  sink,
  auth,
  recorder,
  internalSecrets,
  secretResolver,
  logger,
}: {
  registry: SatelliteCapabilityRegistry;
  db: SafeDatabase<typeof schema>;
  sink: MetricIngestSink;
  auth: IngestAuthenticator;
  recorder: ImportantEventRecorder;
  internalSecrets: InternalSecretsService;
  secretResolver: SecretResolverService;
  logger: Logger;
}): void {
  registry.registerCapability(
    createMetricstreamForwardHandler({ db, sink, auth, logger }),
    pluginMetadata,
  );
  registry.registerCapability(
    createMetricScrapeCapabilityHandler({
      db,
      sink,
      recorder,
      internalSecrets,
      secretResolver,
      logger,
    }),
    pluginMetadata,
  );
  logger.debug(
    "metricstream: registered satellite capabilities (metricstream, metric-scrape)",
  );
}
