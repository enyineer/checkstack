/**
 * Prometheus scrape executor: fetch a target's `/metrics` exposition, parse it,
 * and push the datapoints through the shared sink. This is a PULL source, so a
 * TRANSPORT failure (connect refused, DNS, timeout, non-2xx, oversize body)
 * THROWS a {@link ScrapeError} - the reconciler records it as the target's
 * `lastError` and, after >=3 consecutive failures, raises a `scrape_failing`
 * event. A completed 2xx scrape with zero series is a SUCCESS (the endpoint is
 * reachable, it just exposed nothing).
 *
 * Guards: a hard request timeout (AbortController), a response-size cap (default
 * 5MB, streamed so an unbounded/streaming body is refused before it can exhaust
 * memory), and a per-scrape max-series cap (extra series beyond the bound are
 * dropped, so one runaway scrape cannot blow past the stream's cardinality).
 */

import type { Logger } from "@checkstack/backend-api";
import { createGuardedFetch } from "@checkstack/backend-api";
import {
  SCRAPE_TARGET_URL_SCHEMES,
  capScrapeSeries,
  parsePrometheusText,
} from "@checkstack/metricstream-common";
import type {
  MetricIngestSink,
  MetricPullResult,
  MetricPullTarget,
} from "../extension-point";

/** Default response-size cap for one scrape. */
export const DEFAULT_SCRAPE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * DNS resolver seam for the SSRF pre-flight (injectable in tests). Mirrors the
 * `resolveAndValidateHost` lookup contract: resolve a hostname to its addresses.
 */
export type ScrapeLookupFn = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

/** A transport-level scrape failure (the probe could not complete). */
export class ScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScrapeError";
  }
}

/** Read a response body as text under a hard byte cap (streamed). */
async function readCappedText({
  response,
  maxBytes,
}: {
  response: Response;
  maxBytes: number;
}): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ScrapeError(`response ${declared} bytes exceeds cap ${maxBytes}`);
  }
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ScrapeError(`response body exceeds cap ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Execute one scrape against a resolved target and push its datapoints through
 * the sink. Throws {@link ScrapeError} on any transport failure.
 */
export async function executePrometheusScrape({
  target,
  sink,
  logger,
  now = () => new Date(),
  fetchImpl = fetch,
  maxBytes = DEFAULT_SCRAPE_MAX_BYTES,
  lookupFn,
}: {
  target: MetricPullTarget;
  sink: MetricIngestSink;
  logger: Logger;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  /** DNS resolver for the SSRF pre-flight (defaults to the system resolver). */
  lookupFn?: ScrapeLookupFn;
}): Promise<MetricPullResult> {
  // Parse + scheme-guard the target URL. An un-parseable URL or a non-http(s)
  // scheme is a CONFIG error that prevents the probe from running, so it maps to
  // a transport failure (ScrapeError) rather than a metric.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(target.url);
  } catch {
    throw new ScrapeError(`invalid scrape URL: ${target.url}`);
  }
  if (!(SCRAPE_TARGET_URL_SCHEMES as readonly string[]).includes(parsedUrl.protocol)) {
    throw new ScrapeError(`scrape URL scheme not allowed: ${parsedUrl.protocol}`);
  }

  // SSRF egress guard: resolve the host and reject any denied range (cloud
  // metadata / link-local) BEFORE issuing the request, using the shared
  // guarded-fetch primitive (the same foundation guard the HTTP healthcheck
  // collector uses). The guard re-validates the host on every redirect hop, so a
  // 3xx pointing at an internal address cannot slip past the pre-flight check.
  // Like the collector, it fetches the ORIGINAL url verbatim rather than pinning
  // the connection to the resolved IP - pinning rewrites the URL host and breaks
  // HTTP/2 origins (whose authority is the `:authority` pseudo-header, not the
  // `Host` header).
  //
  // Trade-off: because `fetch` re-resolves DNS itself, this has a DNS-rebind
  // TOCTOU window (a host could resolve to an allowed IP here and a denied one at
  // connect time). It still blocks the common cases - a host that statically
  // resolves to a denied range, and direct denied IP literals.
  const guardedFetch = createGuardedFetch({
    logger,
    fetchImpl,
    ...(lookupFn === undefined ? {} : { lookupFn }),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), target.timeoutMs);

  let response: Response;
  try {
    const headers: Record<string, string> = { accept: "text/plain" };
    if (target.bearerToken) headers.authorization = `Bearer ${target.bearerToken}`;
    response = await guardedFetch(target.url, { headers, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ScrapeError(`scrape timed out after ${target.timeoutMs}ms`);
    }
    throw new ScrapeError(`scrape request failed: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // A non-2xx means the metrics could not be collected - a transport failure
    // for a SCRAPE (unlike a health-check collector asserting on a status code).
    await response.body?.cancel();
    throw new ScrapeError(`scrape returned HTTP ${response.status}`);
  }

  const text = await readCappedText({ response, maxBytes });
  const parsed = parsePrometheusText({ text, now: now() });
  const { kept, seriesCount } = capScrapeSeries({
    datapoints: parsed.datapoints,
    maxSeries: target.maxSeries,
  });

  if (parsed.seriesCount > seriesCount) {
    logger.warn(
      `metricstream: scrape of ${target.name} exposed ${parsed.seriesCount} series, capped to ${seriesCount} (maxSeries ${target.maxSeries})`,
    );
  }

  const write = sink.ingest({ streamId: target.streamId, datapoints: kept, now: now() });
  return { datapointCount: write.accepted, seriesCount };
}
