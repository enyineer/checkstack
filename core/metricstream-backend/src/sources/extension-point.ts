import { z } from "zod";
import {
  createExtensionPoint,
  type RpcService,
  type Logger,
} from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";
import type { IngestAuthenticator } from "@checkstack/ingest-utils";
import type { NormalizedDatapoint } from "@checkstack/metricstream-common";

/**
 * Metric source extension point. metricstream-backend OWNS this contract and
 * registers its three built-in sources (OTLP push, Prometheus pull, native push)
 * through the SAME point (dogfooding), so a future plugin adds a source type with
 * ZERO core changes. A source is EITHER a `push` source (registers raw HTTP
 * handlers that write to the shared sink) OR a `pull` source (a per-target config
 * schema + executor the platform schedules).
 */

/** Result of one sink write - drives the ingest endpoint's 200/429/partial answer. */
export interface IngestSinkResult {
  /** Datapoints admitted into the buffer. */
  accepted: number;
  /** Datapoints refused because the per-pod buffer was full (=> 429). */
  rejected: number;
}

/**
 * The ONE write path both source kinds share: normalize -> buffer -> flush ->
 * fold. Stateless and multi-pod-safe; the sink owns buffering + the flush loop.
 */
export interface MetricIngestSink {
  ingest(input: {
    streamId: string;
    datapoints: NormalizedDatapoint[];
    /** Platform receive time; defaults to now. Used to clamp datapoint ts. */
    now?: Date;
  }): IngestSinkResult;
}

/** Context handed to a PUSH source at init so it can register HTTP handlers. */
export interface MetricPushSourceContext {
  rpc: RpcService;
  sink: MetricIngestSink;
  /** Source-token authenticator (ckms_) for the raw HTTP handler path. */
  auth: IngestAuthenticator;
  logger: Logger;
}

/** A resolved scrape target handed to a PULL source's executor for one run. */
export interface MetricPullTarget {
  id: string;
  streamId: string;
  name: string;
  url: string;
  timeoutMs: number;
  /** Resolved plaintext bearer token, or undefined when none is configured. */
  bearerToken?: string;
  /** Max series to admit from one scrape (defaults to the stream's seriesCap). */
  maxSeries: number;
}

/** Outcome of one pull-source scrape run. */
export interface MetricPullResult {
  /** Datapoints handed to the sink. */
  datapointCount: number;
  /** Distinct series observed in the scrape. */
  seriesCount: number;
}

/** Context handed to a PULL source's executor for one scheduled run. */
export interface MetricPullSourceContext {
  target: MetricPullTarget;
  sink: MetricIngestSink;
  logger: Logger;
}

/**
 * A metric source type. `push` sources register HTTP handlers at init; `pull`
 * sources declare a per-target config schema and an executor the reconciler
 * schedules. Exactly one of the `push`/`pull` seams is implemented per `kind`.
 */
export interface MetricSourceType {
  /** Local id (qualified with the registering plugin id): "otlp" | "prometheus" | "native". */
  id: string;
  displayName: string;
  kind: "push" | "pull";
  /** PUSH: called once at init with the sink + auth to register raw HTTP handlers. */
  registerPush?(ctx: MetricPushSourceContext): void;
  /** PULL: per-target config schema (validates a scrape target's config). */
  targetConfigSchema?: z.ZodTypeAny;
  /** PULL: execute one scrape against a resolved target, writing to the sink. */
  executePull?(ctx: MetricPullSourceContext): Promise<MetricPullResult>;
}

export interface RegisteredMetricSourceType extends MetricSourceType {
  qualifiedId: string;
  ownerPluginId: string;
}

/**
 * Registry of metric source types. Rejects a duplicate qualified id at
 * registration (a source type registered twice is a wiring bug, not a merge).
 */
export interface MetricSourceRegistry {
  register(
    source: MetricSourceType,
    pluginMetadata: PluginMetadata,
  ): void;
  get(qualifiedId: string): RegisteredMetricSourceType | undefined;
  list(): RegisteredMetricSourceType[];
}

export function createMetricSourceRegistry(): MetricSourceRegistry {
  const sources = new Map<string, RegisteredMetricSourceType>();
  return {
    register(source, pluginMetadata) {
      const qualifiedId = `${pluginMetadata.pluginId}.${source.id}`;
      if (sources.has(qualifiedId)) {
        throw new Error(
          `metricstream: duplicate metric source type "${qualifiedId}"`,
        );
      }
      sources.set(qualifiedId, {
        ...source,
        qualifiedId,
        ownerPluginId: pluginMetadata.pluginId,
      });
    },
    get(qualifiedId) {
      return sources.get(qualifiedId);
    },
    list() {
      return [...sources.values()];
    },
  };
}

/** Extension point so any plugin can contribute a metric source type. */
export interface MetricSourceExtensionPoint {
  registerSource(
    source: MetricSourceType,
    pluginMetadata: PluginMetadata,
  ): void;
}

export const metricSourceExtensionPoint =
  createExtensionPoint<MetricSourceExtensionPoint>("metricstream.source");
