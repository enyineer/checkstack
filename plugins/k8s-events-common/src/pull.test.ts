import { describe, it, expect } from "bun:test";
import {
  buildEventsListUrl,
  runK8sEventsPull,
  type K8sEventsPullResult,
} from "./pull";
import type { K8sEventsConfig } from "./schema";

const NOW = () => new Date("2026-07-14T12:00:00.000Z");
const IN_WINDOW = "2026-07-14T11:59:30.000Z"; // 30s ago, inside default window
const OUT_OF_WINDOW = "2026-07-14T11:00:00.000Z"; // 1h ago, outside default window

function makeConfig(overrides: Partial<K8sEventsConfig> = {}): K8sEventsConfig {
  return {
    apiServerUrl: "https://k8s.example:6443",
    bearerToken: "tok-abc",
    maxEventsPerPull: 500,
    lookbackSeconds: 90,
    ...overrides,
  };
}

function eventObj(i: number, eventTime = IN_WINDOW) {
  return {
    metadata: { name: `e${i}`, uid: `uid-${i}`, namespace: "prod" },
    eventTime,
    type: i % 2 === 0 ? "Warning" : "Normal",
    reason: "Scheduled",
    note: `event ${i}`,
    regarding: { kind: "Pod", name: `web-${i}`, namespace: "prod" },
  };
}

type FetchInit = Parameters<typeof fetch>[1];

/** Wrap a bare handler as a `fetch` test double (adds the unused preconnect). */
function asFetch(
  fn: (input: Parameters<typeof fetch>[0], init?: FetchInit) => Promise<Response>,
): typeof fetch {
  return Object.assign(fn, { preconnect: () => {} });
}

/** A stub fetch serving canned pages keyed by the `continue` query param. */
function stubFetch(
  pages: Array<{ items: unknown[]; continue?: string }>,
  calls: Array<{ url: string; init?: FetchInit }> = [],
): typeof fetch {
  return asFetch(async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const cont = new URL(url).searchParams.get("continue") ?? undefined;
    const index = cont
      ? pages.findIndex((p, i) => i > 0 && pages[i - 1]?.continue === cont)
      : 0;
    const page = pages[index];
    if (!page) throw new Error(`no stub page for continue=${cont}`);
    const body = {
      kind: "EventList",
      apiVersion: "events.k8s.io/v1",
      metadata: page.continue ? { continue: page.continue } : {},
      items: page.items,
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("buildEventsListUrl", () => {
  it("uses the all-namespaces path when no namespace is set", () => {
    expect(
      buildEventsListUrl({ apiServerUrl: "https://k8s.example/" }),
    ).toBe("https://k8s.example/apis/events.k8s.io/v1/events");
  });

  it("uses the namespaced path when a namespace is set", () => {
    expect(
      buildEventsListUrl({
        apiServerUrl: "https://k8s.example",
        namespace: "kube-system",
      }),
    ).toBe(
      "https://k8s.example/apis/events.k8s.io/v1/namespaces/kube-system/events",
    );
  });

  it("strips many trailing slashes in linear time (no ReDoS)", () => {
    // Guards the non-regex linear trim that replaced `/\/+$/` (CodeQL
    // js/polynomial-redos): a config value with a long run of trailing slashes
    // must collapse to a single base without pathological backtracking.
    const start = performance.now();
    expect(
      buildEventsListUrl({
        apiServerUrl: `https://k8s.example${"/".repeat(100_000)}`,
      }),
    ).toBe("https://k8s.example/apis/events.k8s.io/v1/events");
    expect(performance.now() - start).toBeLessThan(100);
  });
});

describe("runK8sEventsPull", () => {
  it("sends the bearer token and follows continue pagination", async () => {
    const calls: Array<{ url: string; init?: FetchInit }> = [];
    const fetchImpl = stubFetch(
      [
        { items: [eventObj(1), eventObj(2)], continue: "next-1" },
        { items: [eventObj(3)] },
      ],
      calls,
    );

    const result = await runK8sEventsPull({
      config: makeConfig(),
      fetchImpl,
      now: NOW,
    });

    expect(result.fetched).toBe(3);
    expect(result.records.length).toBe(3);
    expect(calls.length).toBe(2);
    // Bearer header on every request.
    for (const call of calls) {
      const headers = call.init?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer tok-abc");
    }
    // First call has no continue, second carries the returned token.
    expect(new URL(calls[0]!.url).searchParams.get("continue")).toBeNull();
    expect(new URL(calls[1]!.url).searchParams.get("continue")).toBe("next-1");
  });

  it("caps EMITTED in-window records at maxEventsPerPull and stops paging early", async () => {
    const many = Array.from({ length: 400 }, (_, i) => eventObj(i));
    const calls: Array<{ url: string; init?: FetchInit }> = [];
    const fetchImpl = stubFetch(
      [
        { items: many, continue: "p2" },
        { items: many, continue: "p3" },
        { items: many },
      ],
      calls,
    );

    const result = await runK8sEventsPull({
      config: makeConfig({ maxEventsPerPull: 500 }),
      fetchImpl,
      now: NOW,
    });

    // 400 in-window records (page 1) + 100 (page 2) => the cap is on records.
    expect(result.records.length).toBe(500);
    expect(result.fetched).toBe(500);
    expect(result.truncated).toBe(false);
    // 2 requests: paging stops the moment 500 in-window records are collected,
    // so the third page is never issued.
    expect(calls.length).toBe(2);
    // Every page requests the FULL page limit now (scanned != emitted).
    expect(new URL(calls[0]!.url).searchParams.get("limit")).toBe("500");
    expect(new URL(calls[1]!.url).searchParams.get("limit")).toBe("500");
  });

  it("pages PAST an out-of-window backlog to reach in-window events on a later page", async () => {
    // The list API returns events roughly oldest-first with no time filter, so
    // the recent (in-window) events sit on the last pages. The old scanned-item
    // cap spent the whole budget on the backlog and returned ZERO recent events.
    const backlog = Array.from({ length: 500 }, (_, i) =>
      eventObj(i, OUT_OF_WINDOW),
    );
    const calls: Array<{ url: string; init?: FetchInit }> = [];
    const fetchImpl = stubFetch(
      [
        { items: backlog, continue: "p2" },
        { items: backlog, continue: "p3" },
        { items: [eventObj(9990, IN_WINDOW), eventObj(9991, IN_WINDOW)] },
      ],
      calls,
    );

    const result = await runK8sEventsPull({
      config: makeConfig(),
      fetchImpl,
      now: NOW,
    });

    expect(result.records.length).toBe(2);
    expect(result.fetched).toBe(1002);
    expect(result.truncated).toBe(false);
    expect(calls.length).toBe(3);
  });

  it("stops with truncated=true when the page budget is hit with items and a continue pending", async () => {
    // A busy cluster: every page returns items AND a continue token, so the
    // 40-page scan budget is exhausted while the server still has more pages.
    let calls = 0;
    const fetchImpl = asFetch(async () => {
      calls++;
      const body = {
        kind: "EventList",
        apiVersion: "events.k8s.io/v1",
        metadata: { continue: "more" },
        items: [eventObj(calls, OUT_OF_WINDOW)],
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await runK8sEventsPull({
      config: makeConfig(),
      fetchImpl,
      now: NOW,
    });

    expect(result.truncated).toBe(true);
    expect(result.records.length).toBe(0);
    // 40 pages scanned (K8S_EVENTS_MAX_PAGES), one item each; no throw.
    expect(result.fetched).toBe(40);
    expect(calls).toBe(40);
  });

  it("passes fieldSelector/labelSelector and namespace through", async () => {
    const calls: Array<{ url: string; init?: FetchInit }> = [];
    const fetchImpl = stubFetch([{ items: [] }], calls);
    await runK8sEventsPull({
      config: makeConfig({
        namespace: "kube-system",
        fieldSelector: "type=Warning",
        labelSelector: "app=web",
      }),
      fetchImpl,
      now: NOW,
    });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe(
      "/apis/events.k8s.io/v1/namespaces/kube-system/events",
    );
    expect(url.searchParams.get("fieldSelector")).toBe("type=Warning");
    expect(url.searchParams.get("labelSelector")).toBe("app=web");
  });

  it("filters events outside the lookback window", async () => {
    const fetchImpl = stubFetch([
      {
        items: [
          eventObj(1, IN_WINDOW),
          eventObj(2, "2026-07-14T11:00:00.000Z"), // 1h ago, outside window
        ],
      },
    ]);
    const result = await runK8sEventsPull({
      config: makeConfig(),
      fetchImpl,
      now: NOW,
    });
    expect(result.fetched).toBe(2);
    expect(result.records.length).toBe(1);
  });

  it("skips schema-invalid and timestamp-less items and counts them", async () => {
    const fetchImpl = stubFetch([
      {
        items: [
          eventObj(1),
          { series: { count: "not-a-number" }, eventTime: IN_WINDOW }, // invalid
          { reason: "NoTimestamp" }, // no usable timestamp
        ],
      },
    ]);
    const result = await runK8sEventsPull({
      config: makeConfig(),
      fetchImpl,
      now: NOW,
    });
    expect(result.fetched).toBe(3);
    expect(result.skipped).toBe(2);
    expect(result.records.length).toBe(1);
  });

  it("throws on a non-2xx response (transport failure)", async () => {
    const fetchImpl = asFetch(async () =>
      new Response("nope", {
        status: 403,
        statusText: "Forbidden",
      }),
    );
    await expect(
      runK8sEventsPull({ config: makeConfig(), fetchImpl, now: NOW }),
    ).rejects.toThrow(/HTTP 403/);
  });

  it("throws on a non-JSON body", async () => {
    const fetchImpl = asFetch(async () =>
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(
      runK8sEventsPull({ config: makeConfig(), fetchImpl, now: NOW }),
    ).rejects.toThrow(/non-JSON/);
  });

  it("throws when the list envelope is invalid", async () => {
    const fetchImpl = asFetch(async () =>
      new Response(JSON.stringify({ items: "not-an-array" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      runK8sEventsPull({ config: makeConfig(), fetchImpl, now: NOW }),
    ).rejects.toThrow(/envelope invalid/);
  });

  it("returns an empty success for a 2xx empty list", async () => {
    const fetchImpl = stubFetch([{ items: [] }]);
    const result: K8sEventsPullResult = await runK8sEventsPull({
      config: makeConfig(),
      fetchImpl,
      now: NOW,
    });
    expect(result.records).toEqual([]);
    expect(result.fetched).toBe(0);
  });

  it("throws when the server pages forever without progress (page budget)", async () => {
    // Empty pages that always carry a continue token: without the page
    // budget this would spin until the run's abort budget fires.
    const pages = Array.from({ length: 50 }, () => ({
      items: [],
      continue: "again",
    }));
    const fetchImpl = stubFetch(pages);
    await expect(
      runK8sEventsPull({ config: makeConfig(), fetchImpl, now: NOW }),
    ).rejects.toThrow(/page budget/);
  });
});
