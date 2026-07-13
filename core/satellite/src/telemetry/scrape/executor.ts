/**
 * Agent-side Prometheus scrape executor. Mirrors the CORE reconciler's executor
 * (`metricstream-backend`), but instead of writing to a DB sink it RETURNS the
 * capped datapoints so the scrape scheduler can forward them as a
 * "metric-scrape" telemetry batch. Reuses the SAME SSRF egress guard
 * (`resolveAndValidateHost` + `DEFAULT_EGRESS_DENY_CIDRS`) and the SAME pure
 * shaping (`parsePrometheusText` + `capScrapeSeries`), so a target scraped by a
 * satellite is subject to the identical safety envelope as one scraped by core.
 *
 * TRANSPORT vs METRIC (healthcheck-collectors rule): a TRANSPORT failure (connect
 * refused, DNS, TLS, timeout, non-2xx, oversize body, blocked egress, bad URL)
 * THROWS {@link ScrapeError} - the scheduler records it as the target's
 * `lastError`. A completed 2xx scrape exposing zero series is a SUCCESS.
 *
 * SSRF caveat (same as core): the pre-flight validates the resolved host, then
 * fetches the ORIGINAL URL, so a DNS-rebind TOCTOU window remains. It still
 * blocks static resolution to a denied range and direct denied IP literals -
 * important on satellites, which run in customer networks with their own cloud
 * metadata endpoints.
 */

import {
  resolveAndValidateHost,
  DEFAULT_EGRESS_DENY_CIDRS,
} from "@checkstack/backend-api";
import {
  SCRAPE_TARGET_URL_SCHEMES,
  capScrapeSeries,
  parsePrometheusText,
  type NormalizedDatapoint,
} from "@checkstack/metricstream-common";

/** Default response-size cap for one scrape. */
export const DEFAULT_SCRAPE_MAX_BYTES = 5 * 1024 * 1024;

/** DNS resolver seam for the SSRF pre-flight (injectable in tests). */
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

/** The fields the agent executor needs from a bound scrape target. */
export interface AgentScrapeTarget {
  id: string;
  url: string;
  timeoutMs: number;
  maxSeries: number;
  /** Optional bearer token (see the scrape scheduler for how it is delivered). */
  bearerToken?: string;
}

export interface AgentScrapeResult {
  datapoints: NormalizedDatapoint[];
  seriesCount: number;
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
 * Execute one scrape against a bound target and return its capped datapoints.
 * Throws {@link ScrapeError} on any transport failure.
 */
export async function executeAgentScrape({
  target,
  now = () => new Date(),
  fetchImpl = fetch,
  maxBytes = DEFAULT_SCRAPE_MAX_BYTES,
  lookupFn,
}: {
  target: AgentScrapeTarget;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  lookupFn?: ScrapeLookupFn;
}): Promise<AgentScrapeResult> {
  // Parse + scheme-guard the URL. An un-parseable URL or a non-http(s) scheme is
  // a CONFIG error that prevents the probe from running -> transport failure.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(target.url);
  } catch {
    throw new ScrapeError(`invalid scrape URL: ${target.url}`);
  }
  if (
    !(SCRAPE_TARGET_URL_SCHEMES as readonly string[]).includes(
      parsedUrl.protocol,
    )
  ) {
    throw new ScrapeError(`scrape URL scheme not allowed: ${parsedUrl.protocol}`);
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), target.timeoutMs);

  let response: Response;
  try {
    const headers: Record<string, string> = { accept: "text/plain" };
    if (target.bearerToken) headers.authorization = `Bearer ${target.bearerToken}`;
    response = await fetchImpl(target.url, {
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ScrapeError(`scrape timed out after ${target.timeoutMs}ms`);
    }
    throw new ScrapeError(`scrape request failed: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new ScrapeError(`scrape returned HTTP ${response.status}`);
  }

  const text = await readCappedText({ response, maxBytes });
  const parsed = parsePrometheusText({ text, now: now() });
  const { kept, seriesCount } = capScrapeSeries({
    datapoints: parsed.datapoints,
    maxSeries: target.maxSeries,
  });
  return { datapoints: kept, seriesCount };
}
