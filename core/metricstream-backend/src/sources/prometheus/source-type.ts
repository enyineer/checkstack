/**
 * The "prometheus-scrape" telemetry SOURCE TYPE - metricstream's contribution to
 * the telemetry platform's source registry. It REPLACES the old bespoke
 * metric-scrape subsystem (private CRUD table + core reconciler + metric-scrape
 * satellite capability): a Prometheus scrape target is now an ordinary
 * `telemetry_sources` instance the platform schedules (core reconciler) or hands
 * to a satellite (generic `telemetry-pull` capability) via `supportsSatellite`.
 *
 * The pure scrape shaping (`parsePrometheusText` + `capScrapeSeries`) and the
 * URL/interval constants are still owned by `@checkstack/metricstream-common` and
 * shared with the satellite-side pure executor, so a target scraped on the edge
 * applies the identical parse + cap.
 *
 * TRANSPORT vs METRIC (healthcheck-collectors rule): a TRANSPORT failure - a bad
 * URL/scheme, blocked egress, connect/TLS failure, timeout/abort, non-2xx, or an
 * oversize body - THROWS; the platform records it as the instance's `lastError`.
 * A completed 2xx scrape exposing zero series is a SUCCESS (no records emitted).
 *
 * SSRF: the platform hands `ctx.fetch` already wrapped in its egress guard
 * (link-local / cloud-metadata / private ranges denied per policy), so the source
 * MUST use it for the config-derived URL rather than global fetch. The response
 * body is additionally read under a hard size cap so a streaming/unbounded body
 * cannot exhaust memory.
 */

import { z } from "zod";
import { configString, type Logger } from "@checkstack/backend-api";
import type { SecretResolverService } from "@checkstack/secrets-backend";
import { isSecretReference } from "@checkstack/secrets-common";
import {
  defineTelemetrySourceType,
  type TelemetryPullContext,
  type TelemetrySourceTypeDefinition,
} from "@checkstack/telemetry-backend";
import type {
  NormalizedMetricPoint,
  SourceBinding,
} from "@checkstack/telemetry-common";
import {
  DEFAULT_SCRAPE_TIMEOUT_MS,
  MIN_SCRAPE_INTERVAL_SECONDS,
  SCRAPE_TARGET_URL_SCHEMES,
  ScrapeTargetUrlSchema,
  capScrapeSeries,
  parsePrometheusText,
  readCappedText,
  type NormalizedDatapoint,
} from "@checkstack/metricstream-common";
import type { ImportantEventRecorder } from "../../events/recorder";

/** Local id; the platform qualifies it as `${pluginId}.${id}`. */
export const PROMETHEUS_SCRAPE_LOCAL_ID = "prometheus-scrape";

/** Qualified source type id (`metricstream.prometheus-scrape`). Shared with the
 * satellite-side executor (a literal there - the agent cannot import this) and the
 * migration/re-key one-shot. */
export const PROMETHEUS_SCRAPE_QUALIFIED_ID = "metricstream.prometheus-scrape";

/** The x-secret config field carrying the optional bearer token. */
export const PROMETHEUS_SCRAPE_BEARER_FIELD = "bearerToken";

/** Default response-size cap for one scrape (streamed). */
export const DEFAULT_SCRAPE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Defensive per-scrape series cap applied on the CORE path. The AUTHORITATIVE
 * per-stream cardinality cap (`seriesCap`) is enforced downstream by the
 * metricstream ingest sink's fold; this only bounds how many series ONE scrape
 * forwards so a runaway endpoint cannot balloon a single batch. Mirrors the
 * satellite executor's fixed edge cap.
 */
export const DEFAULT_SCRAPE_MAX_SERIES = 5000;

/**
 * Consecutive-failure count at which a `scrape_failing` important event is
 * recorded on the bound metrics stream - once per outage episode (the hook
 * fires on the EXACT crossing, not on every failure past it). Mirrors the old
 * reconciler's threshold so migrated targets keep the same alerting behavior.
 */
export const SCRAPE_FAILING_THRESHOLD = 3;

/**
 * Config for a Prometheus scrape source instance. `url` is http/https validated
 * (defense-in-depth vs SSRF; the platform guard is the runtime enforcement);
 * `timeoutMs` bounds one run; `bearerToken` is an OPTIONAL top-level x-secret
 * string (stored encrypted at rest by the platform, masked on read). It parses a
 * plaintext value, the platform's `__tlsecret__` marker (round-trip), or a
 * `${{ secrets.NAME }}` reference resolved at run time.
 */
export const PrometheusScrapeConfigSchema = z.object({
  url: ScrapeTargetUrlSchema.describe(
    "Prometheus text-exposition endpoint to scrape (e.g. https://app.internal:9090/metrics).",
  ),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(120_000)
    .default(DEFAULT_SCRAPE_TIMEOUT_MS)
    .describe(
      "How long one scrape may take before it is aborted, in milliseconds (1000-120000).",
    ),
  bearerToken: configString({ "x-secret": true })
    .optional()
    .describe(
      "Optional bearer token sent as an Authorization header. Stored encrypted; supports a ${{ secrets.NAME }} reference.",
    ),
});
export type PrometheusScrapeConfig = z.infer<typeof PrometheusScrapeConfigSchema>;

/**
 * Map a metricstream {@link NormalizedDatapoint} to a telemetry
 * {@link NormalizedMetricPoint}. The metric type + counter-kind literals are
 * shared between the two packages ON PURPOSE (see telemetry-common's records.ts),
 * so the fields carry across 1:1 with no translation and no cast. A scrape has no
 * OTLP resource, so `resource` is omitted (the metricstream sink folds only point
 * labels for these).
 */
function datapointToMetricPoint(dp: NormalizedDatapoint): NormalizedMetricPoint {
  return {
    name: dp.name,
    type: dp.type,
    counterKind: dp.counterKind,
    unit: dp.unit,
    labels: dp.labels,
    value: dp.value,
    ts: dp.ts,
    exemplars: dp.exemplars,
  };
}

/**
 * Resolve the bearer token to a plaintext header value, or undefined when none.
 * The platform already resolved a stored `__tlsecret__` secret to plaintext; a
 * `${{ secrets.NAME }}` REFERENCE is resolved here against the active backend
 * (kept as a fresh, rotation-friendly reference rather than being frozen to
 * plaintext at migration). Any other non-empty string is used verbatim.
 */
async function resolveBearer({
  configuredBearer,
  secretResolver,
}: {
  configuredBearer: string | undefined;
  secretResolver: Pick<SecretResolverService, "resolveForRun">;
}): Promise<string | undefined> {
  if (!configuredBearer) return undefined;
  if (isSecretReference(configuredBearer)) {
    const { env } = await secretResolver.resolveForRun({
      secretEnv: { TOKEN: configuredBearer },
    });
    return env.TOKEN;
  }
  return configuredBearer;
}

/**
 * Execute one scrape run against the instance's config and emit the produced
 * metric points through the bound sink. Split out (and given injectable `now` /
 * `maxBytes` seams) so it is unit-testable with a fake pull context. Throws on
 * any transport failure.
 */
export async function executePrometheusPull({
  ctx,
  secretResolver,
  now = () => new Date(),
  maxBytes = DEFAULT_SCRAPE_MAX_BYTES,
  maxSeries = DEFAULT_SCRAPE_MAX_SERIES,
}: {
  ctx: TelemetryPullContext<PrometheusScrapeConfig>;
  secretResolver: Pick<SecretResolverService, "resolveForRun">;
  now?: () => Date;
  maxBytes?: number;
  maxSeries?: number;
}): Promise<void> {
  const { config, sink, fetch: guardedFetch, abortSignal } = ctx;

  // Belt-and-braces scheme guard (the config schema already enforces http/https,
  // but a stored config is only re-validated on write - guard the run path too).
  const parsedUrl = new URL(config.url);
  if (
    !(SCRAPE_TARGET_URL_SCHEMES as readonly string[]).includes(
      parsedUrl.protocol,
    )
  ) {
    throw new Error(`scrape URL scheme not allowed: ${parsedUrl.protocol}`);
  }

  const bearer = await resolveBearer({
    configuredBearer: config.bearerToken,
    secretResolver,
  });

  // Bound the run by the instance's own timeoutMs AND the platform's per-run
  // abort (whichever fires first): the platform aborts on its global budget, this
  // enforces the user-configured timeout on top.
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (abortSignal.aborted) controller.abort();
  else abortSignal.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Response;
  try {
    const headers: Record<string, string> = { accept: "text/plain" };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    response = await guardedFetch(config.url, {
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`scrape timed out after ${config.timeoutMs}ms`);
    }
    throw new Error(`scrape request failed: ${String(error)}`);
  } finally {
    clearTimeout(timer);
    abortSignal.removeEventListener("abort", onParentAbort);
  }

  if (!response.ok) {
    // A non-2xx means the metrics could not be collected - a transport failure
    // for a SCRAPE (unlike a health-check collector asserting on a status code).
    await response.body?.cancel();
    throw new Error(`scrape returned HTTP ${response.status}`);
  }

  const text = await readCappedText({ response, maxBytes });
  const parsed = parsePrometheusText({ text, now: now() });
  const { kept, seriesCount } = capScrapeSeries({
    datapoints: parsed.datapoints,
    maxSeries,
  });
  if (parsed.seriesCount > seriesCount) {
    ctx.logger.warn(
      `metricstream: prometheus scrape exposed ${parsed.seriesCount} series, ` +
        `capped to ${seriesCount} (maxSeries ${maxSeries})`,
    );
  }
  if (kept.length === 0) return;
  await sink.emit("metrics", kept.map((dp) => datapointToMetricPoint(dp)));
}

/**
 * Record a `scrape_failing` important event on the source's bound metrics stream
 * the moment consecutive failures CROSS {@link SCRAPE_FAILING_THRESHOLD}. Fires
 * on the exact crossing only (once per outage episode), matching the old
 * reconciler. A source with no metrics binding (nothing to attribute the event
 * to) is a silent no-op. Best-effort by the hook's contract - a record failure
 * is swallowed by the caller.
 */
async function recordScrapeFailingEvent({
  recorder,
  sourceId,
  sourceName,
  error,
  bindings,
  now,
}: {
  recorder: ImportantEventRecorder;
  sourceId: string;
  sourceName: string;
  error: string;
  bindings: readonly SourceBinding[];
  now: () => Date;
}): Promise<void> {
  const metricsBinding = bindings.find((b) => b.signal === "metrics");
  if (!metricsBinding) return;
  await recorder.record({
    streamId: metricsBinding.streamId,
    ts: now(),
    type: "scrape_failing",
    title: `Scrape target "${sourceName}" is failing`,
    detail: {
      // The pre-telemetry reconciler keyed this on the scrape target id; the
      // source id is that same identity now (the migration reused it).
      sourceId,
      consecutiveFailures: SCRAPE_FAILING_THRESHOLD,
      lastError: error,
    },
  });
}

/**
 * Build the "prometheus-scrape" source type definition. `secretResolver` is
 * closed over so the pull execute can resolve a `${{ secrets.NAME }}` bearer
 * reference at run time (the platform only resolves its own `__tlsecret__`
 * markers). `recorder` is closed over so `onRunFailure` can restore the
 * `scrape_failing` important event on the bound metrics stream.
 */
export function createPrometheusScrapeSourceType({
  secretResolver,
  recorder,
  now = () => new Date(),
}: {
  secretResolver: Pick<SecretResolverService, "resolveForRun">;
  recorder: ImportantEventRecorder;
  now?: () => Date;
  logger?: Logger;
}): TelemetrySourceTypeDefinition<PrometheusScrapeConfig> {
  return defineTelemetrySourceType({
    id: PROMETHEUS_SCRAPE_LOCAL_ID,
    displayName: "Prometheus scrape",
    description:
      "Poll a Prometheus text-exposition endpoint (`/metrics`) and route the " +
      "parsed series into a metric stream. Runs from the core or, when bound, " +
      "from a satellite on the edge.",
    icon: "Activity",
    signals: ["metrics"],
    supportsSatellite: true,
    configSchema: PrometheusScrapeConfigSchema,
    pull: {
      defaultIntervalSeconds: 60,
      minIntervalSeconds: MIN_SCRAPE_INTERVAL_SECONDS,
      execute: (ctx) => executePrometheusPull({ ctx, secretResolver }),
      // Record the `scrape_failing` event exactly on the threshold crossing.
      // NO onRunRecovery: the pre-telemetry reconciler emitted no recovery
      // event, so parity means not adding one here.
      onRunFailure: async ({
        sourceId,
        sourceName,
        error,
        consecutiveFailures,
        bindings,
      }) => {
        if (consecutiveFailures !== SCRAPE_FAILING_THRESHOLD) return;
        await recordScrapeFailingEvent({
          recorder,
          sourceId,
          sourceName,
          error,
          bindings,
          now,
        });
      },
    },
  });
}
