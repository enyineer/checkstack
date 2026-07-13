import { describe, it, expect } from "bun:test";
import {
  executeAgentScrape,
  ScrapeError,
  type AgentScrapeTarget,
  type ScrapeLookupFn,
} from "./executor";

/** Maps every host to a public IP so the SSRF guard passes. */
const publicLookup: ScrapeLookupFn = async () => [
  { address: "93.184.216.34", family: 4 },
];

function target(overrides: Partial<AgentScrapeTarget> = {}): AgentScrapeTarget {
  return {
    id: "t1",
    url: "http://metrics.local/metrics",
    timeoutMs: 5000,
    maxSeries: 1000,
    ...overrides,
  };
}

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain" },
    ...init,
  });
}

describe("executeAgentScrape", () => {
  it("scrapes, parses, and returns capped datapoints", async () => {
    const fetchImpl = (async () =>
      textResponse(
        `# TYPE up gauge\nup{job="api"} 1\n# TYPE reqs counter\nreqs{job="api"} 42`,
      )) as unknown as typeof fetch;

    const result = await executeAgentScrape({
      target: target(),
      fetchImpl,
      lookupFn: publicLookup,
    });
    expect(result.datapoints).toHaveLength(2);
    expect(result.seriesCount).toBe(2);
    expect(result.datapoints.map((d) => d.name).toSorted()).toEqual([
      "reqs",
      "up",
    ]);
  });

  it("caps the number of distinct series at maxSeries", async () => {
    const fetchImpl = (async () =>
      textResponse(
        `# TYPE m gauge\nm{a="1"} 1\nm{a="2"} 2\nm{a="3"} 3`,
      )) as unknown as typeof fetch;
    const result = await executeAgentScrape({
      target: target({ maxSeries: 2 }),
      fetchImpl,
      lookupFn: publicLookup,
    });
    expect(result.seriesCount).toBe(2);
    expect(result.datapoints).toHaveLength(2);
  });

  it("sends a bearer token when configured", async () => {
    const seen: { auth: string | null } = { auth: null };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.auth = new Headers(init.headers).get("authorization");
      return textResponse(`# TYPE up gauge\nup 1`);
    }) as unknown as typeof fetch;
    await executeAgentScrape({
      target: target({ bearerToken: "secret-token" }),
      fetchImpl,
      lookupFn: publicLookup,
    });
    expect(seen.auth).toBe("Bearer secret-token");
  });

  it("rejects a host resolving to the cloud-metadata IP (SSRF guard)", async () => {
    const metadataLookup: ScrapeLookupFn = async () => [
      { address: "169.254.169.254", family: 4 },
    ];
    const fetchImpl = (async () => textResponse("should not reach")) as unknown as typeof fetch;
    await expect(
      executeAgentScrape({
        target: target(),
        fetchImpl,
        lookupFn: metadataLookup,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("throws on a non-2xx response (transport failure)", async () => {
    const fetchImpl = (async () =>
      textResponse("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(
      executeAgentScrape({ target: target(), fetchImpl, lookupFn: publicLookup }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("throws on a non-http(s) URL scheme", async () => {
    await expect(
      executeAgentScrape({
        target: target({ url: "ftp://metrics.local/metrics" }),
        lookupFn: publicLookup,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("throws a ScrapeError when the body exceeds the size cap", async () => {
    const big = "# TYPE m gauge\n" + "m 1\n".repeat(10_000);
    const fetchImpl = (async () => textResponse(big)) as unknown as typeof fetch;
    await expect(
      executeAgentScrape({
        target: target(),
        fetchImpl,
        lookupFn: publicLookup,
        maxBytes: 100,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("treats a completed 2xx scrape with zero series as a success", async () => {
    const fetchImpl = (async () => textResponse("")) as unknown as typeof fetch;
    const result = await executeAgentScrape({
      target: target(),
      fetchImpl,
      lookupFn: publicLookup,
    });
    expect(result.datapoints).toHaveLength(0);
    expect(result.seriesCount).toBe(0);
  });
});
