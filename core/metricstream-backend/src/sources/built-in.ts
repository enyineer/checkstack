/**
 * The three built-in metric source types, contributed through the SAME
 * extension point third-party sources use (dogfooding). OTLP/HTTP and native
 * JSON are PUSH sources (they register raw HTTP handlers); Prometheus is a PULL
 * source (a per-target config schema + `executePull`, scheduled by the
 * reconciler). The push sources close over the ingest `configResolver` + a
 * shared soft rate limiter, since those are ingest concerns not carried on the
 * generic push context.
 */

import { z } from "zod";
import { RateLimiter } from "@checkstack/ingest-utils";
import {
  MIN_SCRAPE_INTERVAL_SECONDS,
  MAX_SCRAPE_INTERVAL_SECONDS,
} from "@checkstack/metricstream-common";
import type { MetricSourceType } from "./extension-point";
import type { StreamConfigResolver } from "../ingest/stream-config";
import { createOtlpMetricsHandler } from "./otlp/endpoint";
import { createNativeMetricsHandler } from "./native/endpoint";
import { executePrometheusScrape } from "./prometheus/scrape";

/** OTLP/HTTP metrics push source (`POST /v1/metrics`). */
export function createOtlpSource({
  configResolver,
  rateLimiter,
}: {
  configResolver: StreamConfigResolver;
  rateLimiter: RateLimiter;
}): MetricSourceType {
  return {
    id: "otlp",
    displayName: "OTLP/HTTP metrics",
    kind: "push",
    registerPush({ rpc, sink, auth, logger }) {
      rpc.registerHttpHandler(
        createOtlpMetricsHandler({ auth, configResolver, sink, logger, rateLimiter }),
        "/v1/metrics",
      );
    },
  };
}

/** Native JSON metrics push source (`POST /ingest`). */
export function createNativeSource({
  configResolver,
  rateLimiter,
}: {
  configResolver: StreamConfigResolver;
  rateLimiter: RateLimiter;
}): MetricSourceType {
  return {
    id: "native",
    displayName: "Native JSON metrics",
    kind: "push",
    registerPush({ rpc, sink, auth }) {
      rpc.registerHttpHandler(
        createNativeMetricsHandler({ auth, configResolver, sink, rateLimiter }),
        "/ingest",
      );
    },
  };
}

/** Prometheus scrape pull source (per-target config + executor). */
export function createPrometheusSource(): MetricSourceType {
  return {
    id: "prometheus",
    displayName: "Prometheus scrape",
    kind: "pull",
    targetConfigSchema: z.object({
      url: z.string().url(),
      intervalSeconds: z
        .number()
        .int()
        .min(MIN_SCRAPE_INTERVAL_SECONDS)
        .max(MAX_SCRAPE_INTERVAL_SECONDS),
      timeoutMs: z.number().int().min(1000).optional(),
      bearerToken: z.string().optional(),
    }),
    executePull({ target, sink, logger }) {
      return executePrometheusScrape({ target, sink, logger });
    },
  };
}
