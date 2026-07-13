import type { Logger, RpcService, SafeDatabase } from "@checkstack/backend-api";
import type { QueueManager } from "@checkstack/queue-api";
import type {
  InternalSecretsService,
  SecretResolverService,
} from "@checkstack/secrets-backend";
import { RateLimiter, type IngestAuthenticator } from "@checkstack/ingest-utils";
import { pluginMetadata } from "@checkstack/metricstream-common";
import type * as schema from "../schema";
import type { ImportantEventRecorder } from "../events/recorder";
import type { StreamConfigResolver } from "../ingest/stream-config";
import type { MetricIngestSink, MetricSourceRegistry } from "./extension-point";
import {
  createOtlpSource,
  createNativeSource,
  createPrometheusSource,
} from "./built-in";
import { createScrapeScheduler } from "./prometheus/reconciler";

/**
 * Handle returned by {@link registerSources}. The two reconcile seams are handed
 * to the API area so scrape-target CRUD reschedules/cancels a target's recurring
 * scrape immediately (their exact names are `reconcileScrapeTarget` /
 * `removeScrapeTarget`, taking `{ targetId }`).
 */
export interface SourcesHandle {
  reconcileScrapeTarget(input: { targetId: string }): Promise<void>;
  removeScrapeTarget(input: { targetId: string }): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Register the built-in metric source types through the extension point
 * (dogfooding), wire the PUSH sources' HTTP handlers against the shared sink +
 * ckms_ authenticator, and start the PULL scheduling subsystem (the
 * `metricstream-scrape` reconciler + competing consumer).
 *
 * The built-ins are registered here at init (alongside any third-party sources
 * already registered against the extension point during `register()`), then the
 * registry is iterated to wire every push source. Pull scheduling is booted
 * fire-and-forget (reconcile + consumer) so init stays non-blocking.
 */
export function registerSources({
  sourceRegistry,
  rpc,
  sink,
  auth,
  logger,
  configResolver,
  queueManager,
  db,
  recorder,
  internalSecrets,
  secretResolver,
}: {
  sourceRegistry: MetricSourceRegistry;
  rpc: RpcService;
  sink: MetricIngestSink;
  auth: IngestAuthenticator;
  logger: Logger;
  configResolver: StreamConfigResolver;
  queueManager: QueueManager;
  db: SafeDatabase<typeof schema>;
  recorder: ImportantEventRecorder;
  internalSecrets: InternalSecretsService;
  secretResolver: SecretResolverService;
}): SourcesHandle {
  // One pod-local soft rate limiter shared by both push endpoints, so a stream's
  // soft per-minute budget is counted across OTLP + native.
  const pushRateLimiter = new RateLimiter();

  // Register the three built-in sources through the extension point.
  sourceRegistry.register(
    createOtlpSource({ configResolver, rateLimiter: pushRateLimiter }),
    pluginMetadata,
  );
  sourceRegistry.register(
    createNativeSource({ configResolver, rateLimiter: pushRateLimiter }),
    pluginMetadata,
  );
  sourceRegistry.register(createPrometheusSource(), pluginMetadata);

  // Wire every PUSH source's HTTP handlers (built-in + any third-party).
  let pushCount = 0;
  for (const source of sourceRegistry.list()) {
    if (source.kind === "push") {
      source.registerPush?.({ rpc, sink, auth, logger });
      pushCount += 1;
    }
  }

  // PULL scheduling: reconciler + competing consumer over `metricstream-scrape`.
  const scheduler = createScrapeScheduler({
    queueManager,
    db,
    recorder,
    sourceRegistry,
    sink,
    internalSecrets,
    secretResolver,
    logger,
  });
  void scheduler.startConsumer().catch((error: unknown) => {
    logger.warn(
      `metricstream: failed to start scrape consumer: ${String(error)}`,
    );
  });
  void scheduler.reconcileAll().catch((error: unknown) => {
    logger.warn(
      `metricstream: initial scrape reconcile failed: ${String(error)}`,
    );
  });

  logger.debug(
    `metricstream: registered ${sourceRegistry.list().length} source type(s), ${pushCount} push handler(s) wired`,
  );

  return {
    reconcileScrapeTarget: scheduler.reconcileScrapeTarget,
    removeScrapeTarget: scheduler.removeScrapeTarget,
    stop: scheduler.stop,
  };
}
