import { describe, it, expect } from "bun:test";
import {
  DEFAULT_SCRAPE_MAX_BYTES,
  executePrometheusPull,
  ScrapeError,
  type PullLookupFn,
} from "./prometheus-executor";

/** Maps every host to a public IP so the SSRF guard passes. */
const publicLookup: PullLookupFn = async () => [
  { address: "93.184.216.34", family: 4 },
];

/** A fetchSecret that resolves no bearer (the common non-authenticated case). */
const noBearer = async () => undefined;

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain" },
    ...init,
  });
}

describe("executePrometheusPull", () => {
  it("parses an exposition and emits mapped wire metric points", async () => {
    const fetchImpl = (async () =>
      textResponse(
        `# TYPE up gauge\nup{job="api"} 1\n# TYPE reqs counter\nreqs{job="api"} 42`,
      )) as unknown as typeof fetch;

    const records = await executePrometheusPull({
      config: { url: "http://metrics.local/metrics" },
      fetchSecret: noBearer,
      abortSignal: new AbortController().signal,
      fetchImpl,
      lookupFn: publicLookup,
    });

    const metrics = records.metrics ?? [];
    expect(metrics).toHaveLength(2);
    const byName = new Map(metrics.map((m) => [m.name, m]));
    const up = byName.get("up")!;
    const reqs = byName.get("reqs")!;
    expect(up.type).toBe("gauge");
    expect(reqs.type).toBe("counter");
    expect(reqs.counterKind).toBe("cumulative");
    // Wire metric points carry ts as an ISO-8601 string.
    expect(typeof up.ts).toBe("string");
    expect(new Date(up.ts).toISOString()).toBe(up.ts);
  });

  it("sends a bearer token when fetchSecret resolves one", async () => {
    const seen: { auth: string | null } = { auth: null };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.auth = new Headers(init.headers).get("authorization");
      return textResponse(`# TYPE up gauge\nup 1`);
    }) as unknown as typeof fetch;

    await executePrometheusPull({
      config: { url: "http://metrics.local/metrics" },
      fetchSecret: async (field) =>
        field === "bearerToken" ? "secret-token" : undefined,
      abortSignal: new AbortController().signal,
      fetchImpl,
      lookupFn: publicLookup,
    });
    expect(seen.auth).toBe("Bearer secret-token");
  });

  it("throws on a non-2xx response (transport failure)", async () => {
    const fetchImpl = (async () =>
      textResponse("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(
      executePrometheusPull({
        config: { url: "http://metrics.local/metrics" },
        fetchSecret: noBearer,
        abortSignal: new AbortController().signal,
        fetchImpl,
        lookupFn: publicLookup,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("throws when the fetch itself rejects (transport failure)", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(
      executePrometheusPull({
        config: { url: "http://metrics.local/metrics" },
        fetchSecret: noBearer,
        abortSignal: new AbortController().signal,
        fetchImpl,
        lookupFn: publicLookup,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("rejects a host resolving to the cloud-metadata IP (SSRF guard)", async () => {
    const metadataLookup: PullLookupFn = async () => [
      { address: "169.254.169.254", family: 4 },
    ];
    const fetchImpl = (async () =>
      textResponse("should not reach")) as unknown as typeof fetch;
    await expect(
      executePrometheusPull({
        config: { url: "http://metrics.local/metrics" },
        fetchSecret: noBearer,
        abortSignal: new AbortController().signal,
        fetchImpl,
        lookupFn: metadataLookup,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("throws when the config has no valid url", async () => {
    await expect(
      executePrometheusPull({
        config: {},
        fetchSecret: noBearer,
        abortSignal: new AbortController().signal,
        lookupFn: publicLookup,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("treats a completed 2xx scrape with zero series as a success", async () => {
    const fetchImpl = (async () => textResponse("")) as unknown as typeof fetch;
    const records = await executePrometheusPull({
      config: { url: "http://metrics.local/metrics" },
      fetchSecret: noBearer,
      abortSignal: new AbortController().signal,
      fetchImpl,
      lookupFn: publicLookup,
    });
    expect(records).toEqual({ metrics: [] });
  });

  it("enforces config.timeoutMs even when the outer abort signal never fires", async () => {
    // The pull scheduler's per-run abort is a separate (platform-default) budget;
    // the config's own timeoutMs must still bound the run. A fetch that only
    // settles when its signal aborts, with a tiny timeoutMs and an outer signal
    // that never fires, must fail with a timeout - proving the executor's own
    // timer fired, not the scheduler's.
    const outer = new AbortController();
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      })) as unknown as typeof fetch;

    await expect(
      executePrometheusPull({
        config: { url: "http://metrics.local/metrics", timeoutMs: 10 },
        fetchSecret: noBearer,
        abortSignal: outer.signal,
        fetchImpl,
        lookupFn: publicLookup,
      }),
    ).rejects.toThrow(/timed out after 10ms/);
    expect(outer.signal.aborted).toBe(false);
  });

  it("rejects a body over the size cap (declared content-length)", async () => {
    const fetchImpl = (async () =>
      textResponse("x", {
        headers: { "content-length": String(DEFAULT_SCRAPE_MAX_BYTES + 1) },
      })) as unknown as typeof fetch;
    await expect(
      executePrometheusPull({
        config: { url: "http://metrics.local/metrics" },
        fetchSecret: noBearer,
        abortSignal: new AbortController().signal,
        fetchImpl,
        lookupFn: publicLookup,
      }),
    ).rejects.toBeInstanceOf(ScrapeError);
  });

  it("caps the pull to maxSeries distinct series", async () => {
    const body = `# TYPE g gauge\ng{h="a"} 1\ng{h="b"} 2\ng{h="c"} 3`;
    const fetchImpl = (async () => textResponse(body)) as unknown as typeof fetch;
    const records = await executePrometheusPull({
      config: { url: "http://metrics.local/metrics", maxSeries: 2 },
      fetchSecret: noBearer,
      abortSignal: new AbortController().signal,
      fetchImpl,
      lookupFn: publicLookup,
    });
    expect(records.metrics ?? []).toHaveLength(2);
  });
});
