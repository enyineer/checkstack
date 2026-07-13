import { describe, it, expect } from "bun:test";
import type { NormalizedDatapoint } from "@checkstack/metricstream-common";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type { MetricIngestSink, MetricPullTarget } from "../extension-point";
import {
  executePrometheusScrape,
  ScrapeError,
  DEFAULT_SCRAPE_MAX_BYTES,
  type ScrapeLookupFn,
} from "./scrape";

const logger = createMockLogger();

/** A resolver that maps every host to a public IP (so the SSRF guard passes). */
const publicLookup: ScrapeLookupFn = async () => [
  { address: "93.184.216.34", family: 4 },
];

function target(overrides: Partial<MetricPullTarget> = {}): MetricPullTarget {
  return {
    id: "t1",
    streamId: "s1",
    name: "prod",
    url: "http://metrics.local/metrics",
    timeoutMs: 5000,
    maxSeries: 1000,
    ...overrides,
  };
}

function capturingSink(): MetricIngestSink & { ingested: NormalizedDatapoint[] } {
  const ingested: NormalizedDatapoint[] = [];
  return {
    ingested,
    ingest({ datapoints }) {
      ingested.push(...datapoints);
      return { accepted: datapoints.length, rejected: 0 };
    },
  };
}

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain" },
    ...init,
  });
}

describe("executePrometheusScrape", () => {
  it("scrapes, parses, and pushes datapoints through the sink", async () => {
    const sink = capturingSink();
    const fetchImpl = (async () =>
      textResponse(`# TYPE up gauge\nup{job="api"} 1\n# TYPE reqs counter\nreqs{job="api"} 42`)) as unknown as typeof fetch;

    const result = await executePrometheusScrape({
      target: target(),
      sink,
      logger,
      fetchImpl,
      lookupFn: publicLookup,
    });
    expect(result.datapointCount).toBe(2);
    expect(result.seriesCount).toBe(2);
    expect(sink.ingested.map((d) => d.name).toSorted()).toEqual(["reqs", "up"]);
  });

  it("sends a bearer token when configured", async () => {
    const seen: { auth: string | null } = { auth: null };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.auth = new Headers(init.headers).get("authorization");
      return textResponse(`# TYPE up gauge\nup 1`);
    }) as unknown as typeof fetch;
    await executePrometheusScrape({
      target: target({ bearerToken: "secret-token" }),
      sink: capturingSink(),
      logger,
      fetchImpl,
      lookupFn: publicLookup,
    });
    expect(seen.auth).toBe("Bearer secret-token");
  });

  it("throws a ScrapeError on a non-2xx response (transport failure)", async () => {
    const fetchImpl = (async () => textResponse("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(
      executePrometheusScrape({
        target: target(),
        sink: capturingSink(),
        logger,
        fetchImpl,
        lookupFn: publicLookup,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("throws a ScrapeError when the network request fails", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(
      executePrometheusScrape({
        target: target(),
        sink: capturingSink(),
        logger,
        fetchImpl,
        lookupFn: publicLookup,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("rejects a body over the size cap (declared content-length)", async () => {
    const fetchImpl = (async () =>
      textResponse("x", { headers: { "content-length": String(DEFAULT_SCRAPE_MAX_BYTES + 1) } })) as unknown as typeof fetch;
    await expect(
      executePrometheusScrape({
        target: target(),
        sink: capturingSink(),
        logger,
        fetchImpl,
        lookupFn: publicLookup,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("caps the scrape to maxSeries distinct series", async () => {
    const sink = capturingSink();
    const body = `# TYPE g gauge\ng{h="a"} 1\ng{h="b"} 2\ng{h="c"} 3`;
    const fetchImpl = (async () => textResponse(body)) as unknown as typeof fetch;
    const result = await executePrometheusScrape({
      target: target({ maxSeries: 2 }),
      sink,
      logger,
      fetchImpl,
      lookupFn: publicLookup,
    });
    expect(result.seriesCount).toBe(2);
    expect(sink.ingested).toHaveLength(2);
  });
});

describe("executePrometheusScrape SSRF egress guard", () => {
  /** Fetch must NEVER be reached when the guard rejects a target. */
  const explodingFetch = (async () => {
    throw new Error("fetch must not be called when the SSRF guard rejects");
  }) as unknown as typeof fetch;

  it("rejects a target whose host resolves to the cloud-metadata IP", async () => {
    const metadataLookup: ScrapeLookupFn = async () => [
      { address: "169.254.169.254", family: 4 },
    ];
    await expect(
      executePrometheusScrape({
        target: target({ url: "http://metadata.internal/metrics" }),
        sink: capturingSink(),
        logger,
        fetchImpl: explodingFetch,
        lookupFn: metadataLookup,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("rejects a bare link-local IP literal without any DNS lookup", async () => {
    await expect(
      executePrometheusScrape({
        target: target({ url: "http://169.254.169.254/metrics" }),
        sink: capturingSink(),
        logger,
        fetchImpl: explodingFetch,
        lookupFn: publicLookup,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("rejects when ANY resolved address is denied (rebind/confusion guard)", async () => {
    const mixedLookup: ScrapeLookupFn = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ];
    await expect(
      executePrometheusScrape({
        target: target({ url: "http://mixed.example.com/metrics" }),
        sink: capturingSink(),
        logger,
        fetchImpl: explodingFetch,
        lookupFn: mixedLookup,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("rejects a non-http(s) scheme before any DNS lookup or fetch", async () => {
    const rejectingLookup: ScrapeLookupFn = async () => {
      throw new Error("lookup must not run for a disallowed scheme");
    };
    await expect(
      executePrometheusScrape({
        target: target({ url: "file:///etc/passwd" }),
        sink: capturingSink(),
        logger,
        fetchImpl: explodingFetch,
        lookupFn: rejectingLookup,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("allows a public host and completes the scrape", async () => {
    const sink = capturingSink();
    const fetchImpl = (async () => textResponse(`# TYPE up gauge\nup 1`)) as unknown as typeof fetch;
    const result = await executePrometheusScrape({
      target: target({ url: "http://prom.public.example/metrics" }),
      sink,
      logger,
      fetchImpl,
      lookupFn: publicLookup,
    });
    expect(result.datapointCount).toBe(1);
    expect(sink.ingested).toHaveLength(1);
  });

  it("allows an internal RFC1918 target by default (monitoring internal hosts is legitimate)", async () => {
    // The default egress denylist blocks cloud-metadata/link-local ONLY, not
    // RFC1918 - a Prometheus target is typically an internal host. Operators who
    // want private ranges blocked extend the denylist.
    const sink = capturingSink();
    const privateLookup: ScrapeLookupFn = async () => [
      { address: "10.0.0.5", family: 4 },
    ];
    const fetchImpl = (async () => textResponse(`# TYPE up gauge\nup 1`)) as unknown as typeof fetch;
    const result = await executePrometheusScrape({
      target: target({ url: "http://prometheus.svc.internal/metrics" }),
      sink,
      logger,
      fetchImpl,
      lookupFn: privateLookup,
    });
    expect(result.datapointCount).toBe(1);
  });
});
