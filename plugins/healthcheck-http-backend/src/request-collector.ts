import {
  Versioned,
  z,
  configString,
  type HealthCheckRunForAggregation,
  type CollectorResult,
  type CollectorStrategy,
  mergeAverage,
  mergeRate,
  VersionedAggregated,
  aggregatedAverage,
  aggregatedRate,
  type InferAggregatedResult,
} from "@checkstack/backend-api";
import {
  healthResultNumber,
  healthResultString,
  healthResultBoolean,
  healthResultJSONPath,
  healthResultSchema,
} from "@checkstack/healthcheck-common";
import crypto from "node:crypto";
import { pluginMetadata } from "./plugin-metadata";
import type { HttpTransportClient } from "./transport-client";

// ============================================================================
// TRACE CONTEXT
// ============================================================================

/** The W3C `traceparent` header name, lowercased for case-insensitive checks. */
const TRACEPARENT_HEADER = "traceparent";

/**
 * Generate a fresh W3C trace context for one probe. `traceId` is 16 random
 * bytes (32 lowercase hex chars), `spanId` is 8 random bytes (16 lowercase hex
 * chars), both from the CSPRNG (`crypto.randomBytes`) - never `Math.random`.
 * The header is version `00`, sampled flag `01`.
 *
 * @returns the `traceId` and the ready-to-send `traceparent` header value.
 */
function buildTraceContext(): { traceId: string; traceparent: string } {
  const traceId = crypto.randomBytes(16).toString("hex");
  const spanId = crypto.randomBytes(8).toString("hex");
  return { traceId, traceparent: `00-${traceId}-${spanId}-01` };
}

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

const requestConfigSchema = z.object({
  // Templatable: supports `{{ environment.baseUrl }}` etc. so one config
  // covers N environments. The `.url()` validation moves to POST-RENDER (see
  // `execute`) because the stored value `{{ environment.baseUrl }}/healthz` is
  // not itself a valid URL.
  url: configString({ "x-templatable": true }).describe(
    "Full URL to request. Supports templating, e.g. {{ environment.baseUrl }}/healthz",
  ),
  method: z
    .enum(["GET", "POST", "PUT", "DELETE", "HEAD"])
    .default("GET")
    .describe("HTTP method"),
  headers: z
    .array(
      z.object({
        name: z.string(),
        // Templatable: header values are a natural per-env case (auth hosts,
        // tenant ids). `name` stays literal.
        value: configString({ "x-templatable": true }),
      }),
    )
    .optional()
    .describe("Request headers"),
  body: configString({
    "x-editor-types": ["none", "raw", "json", "yaml", "xml", "formdata"],
    "x-templatable": true,
  })
    .optional()
    .describe("Request body. Supports templating, e.g. {{ environment.* }}"),
  timeout: z
    .number()
    .min(100)
    .default(30_000)
    .describe("Timeout in milliseconds"),
  // Default-ON with opt-out: emit a fresh W3C `traceparent` header on every
  // request so a traced backend can correlate the probe with its server-side
  // spans. Unchecking it stops emission. Additive + defaulted: stored configs
  // predating this field parse as `true`, which is the intended default-on
  // rollout, so no schema-version bump / migration is required (the collector
  // config stays v1; the migration-chain contract test proves the chain).
  emitTraceparent: z
    .boolean()
    .default(true)
    .describe(
      "Emit a W3C traceparent header so a traced backend can correlate this probe with its server-side spans",
    ),
});

/**
 * Post-render validator for the HTTP `url`. The stored value is a plain
 * templatable string (no `.url()`); the executor renders `{{ environment.* }}`
 * per environment, then this re-validates the CONCRETE rendered URL. A bad
 * render (e.g. an empty environment yielding `/healthz`) surfaces as a clear
 * config error instead of a silent pass.
 */
const renderedUrlSchema = z.string().url();

export type RequestConfig = z.infer<typeof requestConfigSchema>;

// ============================================================================
// RESULT SCHEMAS
// ============================================================================

const requestResultSchema = healthResultSchema({
  statusCode: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Status Code",
    "x-chart-priority": 30,
    // Off by default: the raw status code is an identifier, not a quantity
    // with a meaningful baseline. Legitimate shifts (200 -> 301/302 redirects,
    // content negotiation) are not problems, while real availability loss is
    // already captured by the `success` boolean. Charting stays available for
    // opt-in.
    "x-anomaly-enabled": false,
  }),
  statusText: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Status",
    "x-anomaly-enabled": false,
  }),
  // Set only when this run actually emitted a `traceparent` header (i.e. the
  // `emitTraceparent` config was on AND the user did not supply their own
  // traceparent). Text-only, never an anomaly signal - it is an identifier, not
  // a quantity. NOT ephemeral: historical "View trace" needs it persisted.
  traceId: healthResultString({
    "x-chart-type": "text",
    "x-chart-label": "Trace ID",
    "x-anomaly-enabled": false,
  }).optional(),
  responseTimeMs: healthResultNumber({
    "x-chart-type": "line",
    "x-chart-label": "Response Time",
    "x-chart-unit": "ms",
    "x-chart-priority": 10,
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
  }),
  body: healthResultJSONPath({ "x-ephemeral": true }),
  bodyLength: healthResultNumber({
    "x-chart-type": "counter",
    "x-chart-label": "Body Length",
    "x-chart-unit": "bytes",
    "x-chart-priority": 90,
    "x-anomaly-enabled": false,
  }),
  success: healthResultBoolean({
    "x-chart-type": "boolean",
    "x-chart-label": "HTTP Success",
    "x-chart-true-label": "successful",
    "x-chart-false-label": "failing",
    "x-chart-priority": 20,
    "x-chart-good-direction": "up",
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "dominance",
  }),
});

export type RequestResult = z.infer<typeof requestResultSchema>;

// Aggregated result fields definition
const requestAggregatedFields = {
  avgResponseTimeMs: aggregatedAverage({
    "x-chart-type": "line",
    "x-chart-label": "Avg Response Time",
    "x-chart-unit": "ms",
    "x-chart-priority": 10,
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "lower-is-better",
    // Latency: bias toward fewer false positives. Require several consecutive
    // anomalous buckets, ignore small absolute jitter (tens of ms) so fast
    // endpoints stay quiet, and require a meaningful relative jump.
    "x-anomaly-sensitivity": 2,
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 50,
    "x-anomaly-min-relative-delta": 0.5,
  }),
  successRate: aggregatedRate({
    "x-chart-type": "gauge",
    "x-chart-label": "Success Rate",
    "x-chart-unit": "%",
    "x-chart-priority": 20,
    "x-anomaly-enabled": true,
    "x-anomaly-direction": "higher-is-better",
    // Availability percent: the canonical saturation/failure signal. Debounce
    // transient single-bucket dips and ignore sub-percent noise so only a real,
    // sustained drop alerts.
    "x-anomaly-confirmation-window": 3,
    "x-anomaly-min-absolute-delta": 2,
  }),
};

// Type inferred automatically from field definitions
export type RequestAggregatedResult = InferAggregatedResult<
  typeof requestAggregatedFields
>;

// ============================================================================
// REQUEST COLLECTOR
// ============================================================================

/**
 * Built-in HTTP request collector.
 * Allows users to make HTTP requests and check responses.
 */
export class RequestCollector implements CollectorStrategy<
  HttpTransportClient,
  RequestConfig,
  RequestResult,
  RequestAggregatedResult
> {
  id = "request";
  displayName = "HTTP Request";
  description = "Make an HTTP request and check the response";

  supportedPlugins = [pluginMetadata];

  allowMultiple = true;

  config = new Versioned({ version: 1, schema: requestConfigSchema });
  result = new Versioned({ version: 1, schema: requestResultSchema });
  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: requestAggregatedFields,
  });

  async execute({
    config,
    client,
  }: {
    config: RequestConfig;
    client: HttpTransportClient;
    pluginId: string;
  }): Promise<CollectorResult<RequestResult>> {
    const startTime = Date.now();

    // Post-render validation: the stored `url` is a plain templatable string,
    // so `.url()` cannot run at store time. The executor has already rendered
    // `{{ environment.* }}` into `config.url` by the time we get here; validate
    // the CONCRETE rendered value now. A bad render (e.g. an empty environment)
    // yields a clear config error rather than a confusing fetch failure.
    const urlValidation = renderedUrlSchema.safeParse(config.url);
    if (!urlValidation.success) {
      return {
        result: {
          statusCode: 0,
          statusText: "Invalid URL",
          responseTimeMs: Date.now() - startTime,
          body: "",
          bodyLength: 0,
          success: false,
        },
        error: `Rendered URL is invalid: ${JSON.stringify(config.url)}`,
      };
    }

    // Convert headers array to record
    const headers: Record<string, string> = {};
    for (const h of config.headers ?? []) {
      headers[h.name] = h.value;
    }

    // Emit a fresh W3C traceparent unless disabled, or unless the user already
    // configured their own traceparent header (any casing) - theirs wins and is
    // opaque to us, so we do NOT override it and do NOT record a traceId. This
    // mirrors the strategy's "don't override an explicit user header" precedent
    // (see mergeAuthHeader). The generated id is recorded on the result so a
    // "View trace" surface can correlate this run with the server-side spans.
    let emittedTraceId: string | undefined;
    const userSuppliedTraceparent = Object.keys(headers).some(
      (name) => name.toLowerCase() === TRACEPARENT_HEADER,
    );
    if (config.emitTraceparent && !userSuppliedTraceparent) {
      const { traceId, traceparent } = buildTraceContext();
      headers[TRACEPARENT_HEADER] = traceparent;
      emittedTraceId = traceId;
    }

    const response = await client.exec({
      url: config.url,
      method: config.method,
      headers,
      body: config.body,
      timeout: config.timeout,
    });

    const responseTimeMs = Date.now() - startTime;
    // `success` is an ASSERTABLE METRIC (2xx/3xx), not a collector-failure
    // signal. Receiving ANY response - including a 4xx/5xx - is a successful
    // collection: the server was reached and answered. A real transport failure
    // (DNS, connect, TLS, timeout, aborted) throws out of `client.exec` above
    // and the executor records it as a collector failure. We must NOT set the
    // `error` field here for a received-but-non-2xx response, otherwise the
    // executor hard-fails the run and assertions (e.g. "statusCode equals 404")
    // never get a chance to decide health.
    const success = response.statusCode >= 200 && response.statusCode < 400;

    return {
      result: {
        statusCode: response.statusCode,
        statusText: response.statusText,
        responseTimeMs,
        body: response.body ?? "",
        bodyLength: response.body?.length ?? 0,
        success,
        // Only present when this run actually emitted the header (same id).
        ...(emittedTraceId === undefined ? {} : { traceId: emittedTraceId }),
      },
    };
  }

  mergeResult(
    existing: RequestAggregatedResult | undefined,
    newRun: HealthCheckRunForAggregation<RequestResult>,
  ): RequestAggregatedResult {
    return {
      avgResponseTimeMs: mergeAverage(
        existing?.avgResponseTimeMs,
        newRun.metadata?.responseTimeMs,
      ),
      successRate: mergeRate(existing?.successRate, newRun.metadata?.success),
    };
  }
}
