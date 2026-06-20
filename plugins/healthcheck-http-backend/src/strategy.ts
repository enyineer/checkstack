import {
  HealthCheckStrategy,
  HealthCheckRunForAggregation,
  Versioned,
  VersionedAggregated,
  aggregatedCounter,
  mergeCounter,
  z,
  type InferAggregatedResult,
  type ConnectedClient,
  type TransportTimings,
  baseStrategyConfigSchema,
  DEFAULT_EGRESS_DENY_CIDRS,
  resolveAndValidateHost,
  pinUrlToIp,
} from "@checkstack/backend-api";
import {
  healthResultString,
  healthResultSchema,
  StrategyCategory,
} from "@checkstack/healthcheck-common";
import { probeConnectTiming } from "./connect-probe";
import type {
  HttpTransportClient,
  HttpRequest,
  HttpResponse,
} from "./transport-client";

// ============================================================================
// SCHEMAS
// ============================================================================

/**
 * HTTP health check configuration schema.
 * Global defaults only - action params moved to RequestCollector.
 *
 * `egressDenyCidrs` extends the SSRF guard's default denylist. The collector
 * runs in-process on the trusted core, so it always refuses to connect to
 * cloud-metadata + link-local ranges (the secure default); operators can add
 * further CIDRs here (e.g. to block a sensitive internal range) WITHOUT losing
 * the metadata/link-local block. Leaving it unset keeps the secure default.
 * RFC1918 / internal probing stays allowed by default (a monitoring tool's job).
 *
 * Optional + additive: existing stored configs (which lack this field) remain
 * valid, so no schema-version bump / migration is required.
 */
export const httpHealthCheckConfigSchema = baseStrategyConfigSchema.extend({
  egressDenyCidrs: z
    .array(z.string())
    .optional()
    .describe(
      "Extra CIDR ranges to deny for outbound requests (added on top of the always-on cloud-metadata/link-local block).",
    ),
});

export type HttpHealthCheckConfig = z.infer<typeof httpHealthCheckConfigSchema>;

// The migrate input is `unknown` per the versioning chain, so narrowing is
// done with `typeof`/`in` guards (no casts).

/** Type guard: the migrate input is a plain object whose keys can be probed. */
function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null;
}

/** Read a numeric `timeout` field from a legacy/current config blob. */
function readTimeout(data: unknown): number | undefined {
  if (!isRecord(data)) return undefined;
  const value = data.timeout;
  return typeof value === "number" ? value : undefined;
}

/** Per-run result metadata */
const httpResultMetadataSchema = healthResultSchema({
  error: healthResultString({
    "x-chart-type": "status",
    "x-chart-label": "Error",
    "x-anomaly-enabled": false,
  }).optional(),
});

type HttpResultMetadata = z.infer<typeof httpResultMetadataSchema>;

/** Aggregated field definitions for bucket merging */
const httpAggregatedFields = {
  errorCount: aggregatedCounter({
    "x-chart-type": "counter",
    "x-chart-label": "Errors",
    // Off by default: a raw per-bucket error COUNT scales with how many runs
    // land in the bucket, so it has no stable baseline and drifts with traffic
    // volume. The percent form of the same signal (`successRate`) is the one
    // that alerts; this absolute twin stays chart-only to avoid duplicate,
    // noisy alerting.
    "x-anomaly-enabled": false,
  }),
};

type HttpAggregatedResult = InferAggregatedResult<typeof httpAggregatedFields>;

// ============================================================================
// STRATEGY
// ============================================================================

export class HttpHealthCheckStrategy implements HealthCheckStrategy<
  HttpHealthCheckConfig,
  HttpTransportClient,
  HttpResultMetadata,
  typeof httpAggregatedFields
> {
  id = "http";
  displayName = "HTTP/HTTPS Health Check";
  description = "HTTP endpoint health monitoring";
  category = StrategyCategory.NETWORKING;

  /**
   * DNS resolver used by the SSRF guard. Defaults to the system resolver
   * (`resolveAndValidateHost`'s built-in). Injectable so tests can drive the
   * guard deterministically without real network DNS.
   */
  constructor(
    private readonly lookupFn?: (
      hostname: string,
    ) => Promise<Array<{ address: string; family: number }>>,
  ) {}

  config: Versioned<HttpHealthCheckConfig> = new Versioned({
    version: 3, // v3 for createClient pattern with action params moved to RequestCollector
    schema: httpHealthCheckConfigSchema,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Add timeout field",
        // IDEMPOTENT: only a genuine v1 blob carries url/method. If neither is
        // present the data is already v2+ — pass it through untouched.
        migrate: (data: unknown): unknown => {
          if (isRecord(data) && ("url" in data || "method" in data)) {
            return { ...data, timeout: readTimeout(data) ?? 30_000 };
          }
          return data;
        },
      },
      {
        fromVersion: 2,
        toVersion: 3,
        description:
          "Remove url/method/headers/body (moved to RequestCollector)",
        // IDEMPOTENT: only a genuine v2 blob still carries the moved fields. An
        // already-v3 blob (just `{ timeout }`) passes through untouched.
        migrate: (data: unknown): unknown => {
          if (
            isRecord(data) &&
            ("url" in data ||
              "method" in data ||
              "headers" in data ||
              "body" in data)
          ) {
            return { timeout: readTimeout(data) };
          }
          return data;
        },
      },
    ],
  });

  result: Versioned<HttpResultMetadata> = new Versioned({
    version: 3,
    schema: httpResultMetadataSchema,
    // The result version tracks the strategy version (bumped in lockstep
    // with the createClient refactor); the result SHAPE never changed, so
    // these are pass-through migrations. They are required for a COMPLETE
    // v1->v3 chain (enforced at construction) so a genuinely-v1 stored
    // result still reads back via assume-v1-on-read.
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        description: "Migrate to createClient pattern (no result changes)",
        migrate: (data: unknown) => data,
      },
      {
        fromVersion: 2,
        toVersion: 3,
        description: "Move request params to RequestCollector (no result changes)",
        migrate: (data: unknown) => data,
      },
    ],
  });

  aggregatedResult = new VersionedAggregated({
    version: 1,
    fields: httpAggregatedFields,
  });

  mergeResult(
    existing: HttpAggregatedResult | undefined,
    newRun: HealthCheckRunForAggregation<HttpResultMetadata>,
  ): HttpAggregatedResult {
    const hasError = !!newRun.metadata?.error;
    return {
      errorCount: mergeCounter(existing?.errorCount, hasError),
    };
  }

  /**
   * Create an HTTP transport client for one-shot requests.
   * All request parameters come from the collector (RequestCollector).
   */
  async createClient(
    config: HttpHealthCheckConfig,
  ): Promise<ConnectedClient<HttpTransportClient>> {
    const validatedConfig = this.config.validate(config);

    // SSRF secure default: deny cloud-metadata + link-local always, plus any
    // operator-configured extra ranges. This collector runs IN-PROCESS on the
    // trusted core, so without this guard a healthcheck author could point a
    // check at http://169.254.169.254/... and read the response body.
    const denyCidrs = [
      ...DEFAULT_EGRESS_DENY_CIDRS,
      ...(validatedConfig.egressDenyCidrs ?? []),
    ];
    const lookupFn = this.lookupFn;

    // Mutable per-run timings holder. `exec` writes the request's transport
    // phases here so the executor can lift them into `metadata.timings`.
    const timings: TransportTimings = {};

    const client: HttpTransportClient = {
      async exec(request: HttpRequest): Promise<HttpResponse> {
        const controller = new AbortController();
        const timeoutMs = request.timeout ?? validatedConfig.timeout;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          // Resolve the host to IP(s), reject any denied range, and PIN the
          // connection to the validated IP (rewrite the URL host to the IP,
          // restore the original Host header + TLS SNI). Pinning is what resists
          // DNS-rebind: we connect to exactly the IP we checked. The REQUEST is
          // byte-for-byte the path that has always worked - only the surrounding
          // timing measurement is new, so request behaviour cannot regress.
          const requestUrl = new URL(request.url);
          const dnsStart = performance.now();
          const target = await resolveAndValidateHost({
            host: requestUrl.hostname,
            denyCidrs,
            ...(lookupFn === undefined ? {} : { lookupFn }),
          });
          const dnsMs = Math.max(0, performance.now() - dnsStart);
          const pinnedUrl = pinUrlToIp(request.url, target.ip);
          const pinned = new URL(pinnedUrl);
          const isHttps = pinned.protocol === "https:";

          // Connect/TLS timing comes from a short-lived raw probe to the SAME
          // validated IP: Bun's `fetch` socket exposes no connect/handshake
          // events, but raw net/tls sockets do. Best-effort, runs alongside the
          // request, and never fails the check.
          const probePromise = probeConnectTiming({
            ip: target.ip,
            port: pinned.port === "" ? (isHttps ? 443 : 80) : Number(pinned.port),
            tls: isHttps,
            servername: requestUrl.hostname,
            timeoutMs,
          });

          const pinnedHeaders: Record<string, string> = {
            ...request.headers,
            // Preserve the virtual host the server expects.
            host: requestUrl.host,
          };

          // `fetch` resolves at the response HEADERS (time-to-first-byte);
          // consuming the body is the transfer phase.
          const fetchStart = performance.now();
          const response = await fetch(pinnedUrl, {
            method: request.method,
            headers: pinnedHeaders,
            body: request.body,
            signal: controller.signal,
            // Bun: keep TLS validation against the ORIGINAL hostname even though
            // we connected to an IP literal.
            tls: { serverName: requestUrl.hostname },
          });
          const ttfbMs = Math.max(0, performance.now() - fetchStart);

          // Read body BEFORE clearing the timeout - body streaming can also hang.
          const transferStart = performance.now();
          const body = await response.text();
          const transferMs = Math.max(0, performance.now() - transferStart);

          clearTimeout(timeoutId);

          const probe = await probePromise;
          // Server wait = time-to-first-byte minus the connection setup we could
          // measure. Clamped: the probe is a parallel connection, so on a warm
          // path its setup can exceed the request's ttfb.
          const waitMs = Math.max(
            0,
            ttfbMs - ((probe.connectMs ?? 0) + (probe.tlsMs ?? 0)),
          );

          // Last-request-wins: reset then write this request's phases.
          delete timings.dnsMs;
          delete timings.connectMs;
          delete timings.tlsMs;
          delete timings.waitMs;
          delete timings.transferMs;
          delete timings.processingMs;
          timings.dnsMs = dnsMs;
          if (probe.connectMs !== undefined) timings.connectMs = probe.connectMs;
          if (probe.tlsMs !== undefined) timings.tlsMs = probe.tlsMs;
          timings.waitMs = waitMs;
          timings.transferMs = transferMs;

          const headers: Record<string, string> = {};
          for (const [key, value] of response.headers) {
            headers[key.toLowerCase()] = value;
          }

          // A received response - INCLUDING a 4xx/5xx - returns normally and is
          // an assertable metric (never an error). Only a genuine transport
          // failure (DNS, connect, TLS, timeout, abort) throws.
          return {
            statusCode: response.status,
            statusText: response.statusText,
            headers,
            body,
            contentType: headers["content-type"],
          };
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      },
    };

    return {
      client,
      timings,
      close: () => {
        // HTTP is stateless, nothing to close
      },
    };
  }
}
