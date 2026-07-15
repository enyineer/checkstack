/**
 * Satellite-side telemetry-PULL executor for the metricstream Prometheus source
 * (`metricstream.prometheus-scrape`). It replaces the old private metric-scrape
 * capability: instead of a bespoke "metric-scrape" batch, it plugs into the
 * generic `telemetry-pull` capability and RETURNS JSON-safe wire records the
 * pull scheduler forwards. Reuses the SAME SSRF egress guard
 * (`resolveAndValidateHost` + `DEFAULT_EGRESS_DENY_CIDRS`) and the SAME pure
 * shaping (`parsePrometheusText` + `capScrapeSeries`) as the core reconciler and
 * the former scrape executor, so a target pulled by a satellite is subject to the
 * identical safety envelope as one scraped by core.
 *
 * TRANSPORT vs METRIC (healthcheck-collectors rule): a TRANSPORT failure (connect
 * refused, DNS, TLS, abort/timeout, non-2xx, oversize body, blocked egress, bad
 * URL) THROWS {@link ScrapeError} - the scheduler records it as the instance's
 * `lastError`. A completed 2xx scrape exposing zero series is a SUCCESS returning
 * `{ metrics: [] }`.
 *
 * SSRF caveat (same as core): the pre-flight validates the resolved host, then
 * fetches the ORIGINAL URL, so a DNS-rebind TOCTOU window remains. It still
 * blocks static resolution to a denied range and direct denied IP literals -
 * important on satellites, which run in customer networks with their own cloud
 * metadata endpoints.
 *
 * TIMEOUT: the fetch is bound to BOTH the pull scheduler's per-run abort
 * (`ctx.abortSignal`, a platform-default budget) AND the source config's own
 * `timeoutMs`, whichever fires first - so a target's legal 60-120s timeout is
 * honored and a strict 2s timeout is not silently relaxed, matching core
 * execution. Either firing surfaces as a transport failure.
 */

import { z } from "zod";
import {
  resolveAndValidateHost,
  DEFAULT_EGRESS_DENY_CIDRS,
} from "@checkstack/backend-api";
import {
  SCRAPE_TARGET_URL_SCHEMES,
  capScrapeSeries,
  parsePrometheusText,
  readCappedText,
} from "@checkstack/metricstream-common";
import {
  normalizedMetricPointToWire,
  type SatellitePullExecutor,
  type SatellitePullExecutorContext,
  type WireMetricPoint,
  type WirePullRecords,
} from "@checkstack/telemetry-common";

/** Default response-size cap for one pull (streamed body cap). */
export const DEFAULT_SCRAPE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Defensive per-run edge bound on distinct series when the pushed config carries
 * no `maxSeries`. The AUTHORITATIVE per-stream cardinality cap is enforced on the
 * CORE side by the metricstream telemetry sink; this only bounds a single pull's
 * response so a misconfigured target cannot balloon one batch.
 */
export const DEFAULT_SCRAPE_MAX_SERIES = 5000;

/**
 * Non-secret pull config for a Prometheus source instance. Arrives as a
 * `Record<string, unknown>` (the wire only guarantees an object), so parse it
 * defensively; a missing/invalid `url` is a config error that throws.
 */
const PrometheusPullConfigSchema = z.object({
  url: z.string(),
  timeoutMs: z.number().int().optional(),
  maxSeries: z.number().int().optional(),
});

/** DNS resolver seam for the SSRF pre-flight (injectable in tests). */
export type PullLookupFn = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

/** A transport-level pull failure (the probe could not complete). */
export class ScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScrapeError";
  }
}

/**
 * Execute one Prometheus pull for a source instance and return its capped
 * datapoints as JSON-safe wire metric points. Throws {@link ScrapeError} on any
 * transport failure. Module-level + fully injectable (fetch, DNS lookup, byte
 * cap, clock) so it can be driven deterministically in tests; the exported
 * {@link prometheusPullExecutor} delegates here with the run context's fields.
 */
export async function executePrometheusPull({
  config,
  fetchSecret,
  abortSignal,
  fetchImpl = fetch,
  lookupFn,
  maxBytes = DEFAULT_SCRAPE_MAX_BYTES,
  now = () => new Date(),
}: {
  config: Record<string, unknown>;
  fetchSecret: (field: string) => Promise<string | undefined>;
  abortSignal: AbortSignal;
  fetchImpl?: typeof fetch;
  lookupFn?: PullLookupFn;
  maxBytes?: number;
  now?: () => Date;
}): Promise<WirePullRecords> {
  // Parse the non-secret config defensively; a missing/invalid url is a config
  // error that prevents the probe from running -> transport failure.
  const parsedConfig = PrometheusPullConfigSchema.safeParse(config);
  if (!parsedConfig.success) {
    throw new ScrapeError(
      `invalid prometheus pull config: ${parsedConfig.error.message}`,
    );
  }
  const { url, maxSeries, timeoutMs } = parsedConfig.data;

  // Parse + scheme-guard the URL. An un-parseable URL or a non-http(s) scheme is
  // a CONFIG error that prevents the probe from running -> transport failure.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new ScrapeError(`invalid scrape URL: ${url}`);
  }
  if (
    !(SCRAPE_TARGET_URL_SCHEMES as readonly string[]).includes(
      parsedUrl.protocol,
    )
  ) {
    throw new ScrapeError(
      `scrape URL scheme not allowed: ${parsedUrl.protocol}`,
    );
  }

  // SSRF egress guard: resolve + validate the host before issuing the request.
  try {
    await resolveAndValidateHost({
      host: parsedUrl.hostname,
      denyCidrs: DEFAULT_EGRESS_DENY_CIDRS,
      ...(lookupFn === undefined ? {} : { lookupFn }),
    });
  } catch (error) {
    throw new ScrapeError(`scrape target rejected: ${String(error)}`);
  }

  // Bearer is a secret field: fetched JIT (never rides the pushed config).
  const bearer = await fetchSecret("bearerToken");
  const headers: Record<string, string> = { accept: "text/plain" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;

  // Bound the run by the instance config's OWN timeoutMs AND the pull
  // scheduler's abort (whichever fires first). The scheduler already aborts on
  // its per-run budget (a platform default); this additionally enforces the
  // user-configured timeout, so a migrated target's legal 60-120s timeout is
  // honored on the edge and a strict 2s timeout is not silently relaxed -
  // matching core execution (see the metricstream source type's execute).
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort();
  if (abortSignal.aborted) controller.abort();
  else abortSignal.addEventListener("abort", onParentAbort, { once: true });
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, { headers, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new ScrapeError(`scrape timed out after ${timeoutMs}ms`);
    }
    if (controller.signal.aborted) {
      throw new ScrapeError("scrape aborted before completion");
    }
    throw new ScrapeError(`scrape request failed: ${String(error)}`);
  } finally {
    // The timer bounds the connect/fetch; the body read below is bounded by the
    // size cap, so clear the timer once the response resolves (matches core).
    if (timer) clearTimeout(timer);
    abortSignal.removeEventListener("abort", onParentAbort);
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new ScrapeError(`scrape returned HTTP ${response.status}`);
  }

  const text = await readCappedText({
    response,
    maxBytes,
    makeError: (message) => new ScrapeError(message),
  });
  const parsed = parsePrometheusText({ text, now: now() });
  const { kept } = capScrapeSeries({
    datapoints: parsed.datapoints,
    maxSeries: maxSeries ?? DEFAULT_SCRAPE_MAX_SERIES,
  });

  // A NormalizedDatapoint is structurally a NormalizedMetricPoint (identical
  // metric-type/counter-kind literals and the SHARED MetricExemplarSchema;
  // `resource` is optional), so reuse the shared ts->ISO serializer rather than
  // re-deriving the wire shape here.
  const metrics: WireMetricPoint[] = kept.map((dp) =>
    normalizedMetricPointToWire(dp),
  );
  return { metrics } satisfies WirePullRecords;
}

/**
 * The satellite-side pull executor for the metricstream Prometheus source. The
 * satellite build registers this in {@link telemetryPullExecutorRegistry} so an
 * assigned `metricstream.prometheus-scrape` instance resolves to it.
 */
export const prometheusPullExecutor: SatellitePullExecutor = {
  sourceTypeId: "metricstream.prometheus-scrape",
  execute: (ctx: SatellitePullExecutorContext): Promise<WirePullRecords> =>
    executePrometheusPull({
      config: ctx.config,
      fetchSecret: ctx.fetchSecret,
      abortSignal: ctx.abortSignal,
    }),
};
