/**
 * Register telemetry's satellite pull-capability handler against
 * satellite-backend's extension point (dependency inversion: the telemetry
 * platform CONTRIBUTES; satellite-backend, the host, never imports telemetry).
 *
 * Registration is buffered behind the extension point, so calling this at init
 * time (once the db / registries / secret store are built) is load-order safe.
 */

import type { Logger, SafeDatabase } from "@checkstack/backend-api";
import { pluginMetadata } from "@checkstack/telemetry-common";
import type { SatelliteCapabilityRegistry } from "@checkstack/satellite-backend";
import * as schema from "../schema";
import type { SourceSecretStore } from "../secrets";
import type {
  TelemetrySinkRegistry,
  TelemetrySourceRegistry,
} from "../extension-points";
import { createTelemetryPullCapabilityHandler } from "./pull-capability";
import type { SecretResolverService } from "@checkstack/secrets-backend";

export function registerSatellitePullCapability({
  registry,
  db,
  sourceRegistry,
  sinkRegistry,
  secretStore,
  secretResolver,
  logger,
}: {
  registry: SatelliteCapabilityRegistry;
  db: SafeDatabase<typeof schema>;
  sourceRegistry: TelemetrySourceRegistry;
  sinkRegistry: TelemetrySinkRegistry;
  secretStore: SourceSecretStore;
  secretResolver: SecretResolverService;
  logger: Logger;
}): void {
  registry.registerCapability(
    createTelemetryPullCapabilityHandler({
      db,
      sourceRegistry,
      sinkRegistry,
      secretStore,
      secretResolver,
      logger,
    }),
    pluginMetadata,
  );
  logger.debug("telemetry: registered satellite capability (telemetry-pull)");
}
