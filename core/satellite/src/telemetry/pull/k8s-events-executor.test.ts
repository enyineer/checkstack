import { describe, it, expect } from "bun:test";
import { createK8sEventsPullExecutor } from "./k8s-events-executor";
import { K8S_EVENTS_SOURCE_TYPE_ID } from "@checkstack/k8s-events-common";

const NOW = () => new Date("2026-07-14T12:00:00.000Z");
const IN_WINDOW = "2026-07-14T11:59:30.000Z";

/** Resolve every host to a public IP so the SSRF guard admits the request. */
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

/** Wrap a bare handler as a `fetch` test double (adds the unused preconnect). */
function asFetch(
  fn: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
): typeof fetch {
  return Object.assign(fn, { preconnect: () => {} });
}

function listBody(items: unknown[]) {
  return JSON.stringify({
    kind: "EventList",
    apiVersion: "events.k8s.io/v1",
    metadata: {},
    items,
  });
}

describe("k8s-events satellite executor", () => {
  it("has the qualified source type id", () => {
    expect(createK8sEventsPullExecutor().sourceTypeId).toBe(
      K8S_EVENTS_SOURCE_TYPE_ID,
    );
    expect(K8S_EVENTS_SOURCE_TYPE_ID).toBe("k8s-events.k8s-events");
  });

  it("fetches the bearer JIT, sends it, and returns wire log records", async () => {
    const seen: Array<{ url: string; init?: Parameters<typeof fetch>[1] }> = [];
    const fetchImpl = asFetch(async (input, init) => {
      seen.push({ url: String(input), init });
      return new Response(
        listBody([
          {
            metadata: { uid: "u1", namespace: "prod" },
            eventTime: IN_WINDOW,
            type: "Warning",
            reason: "BackOff",
            note: "boom",
            regarding: { kind: "Pod", name: "web-0" },
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const secretFields: string[] = [];
    const executor = createK8sEventsPullExecutor({
      fetchImpl,
      lookupFn: publicLookup,
      now: NOW,
    });

    const result = await executor.execute({
      config: { apiServerUrl: "https://k8s.example" },
      fetchSecret: async (field) => {
        secretFields.push(field);
        return field === "bearerToken" ? "tok-xyz" : undefined;
      },
      abortSignal: new AbortController().signal,
    });

    expect(secretFields).toEqual(["bearerToken"]);
    const headers = seen[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok-xyz");

    expect(result.logs).toHaveLength(1);
    const record = result.logs?.[0];
    // Wire records carry ts as an ISO-8601 STRING (not a Date).
    expect(typeof record?.ts).toBe("string");
    expect(record?.ts).toBe("2026-07-14T11:59:30.000Z");
    expect(record?.body).toBe("BackOff: boom");
    expect(record?.severityText).toBe("Warning");
    expect(record?.attributes?.["k8s.event.uid"]).toBe("u1");
  });

  it("warns via the run logger when the pull scan is truncated", async () => {
    // Every page returns one OUT-OF-WINDOW item plus a continue token, so the
    // 40-page scan budget is exhausted with items seen => truncated=true.
    const fetchImpl = asFetch(
      async () =>
        new Response(
          JSON.stringify({
            kind: "EventList",
            apiVersion: "events.k8s.io/v1",
            metadata: { continue: "more" },
            items: [
              {
                metadata: { uid: "old", namespace: "prod" },
                eventTime: "2026-07-14T11:00:00.000Z",
                type: "Normal",
                reason: "Old",
                note: "backlog",
                regarding: { kind: "Pod", name: "web-0" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const warns: string[] = [];
    const executor = createK8sEventsPullExecutor({
      fetchImpl,
      lookupFn: publicLookup,
      now: NOW,
    });

    const result = await executor.execute({
      config: { apiServerUrl: "https://k8s.example" },
      fetchSecret: async () => "tok-xyz",
      abortSignal: new AbortController().signal,
      logger: {
        info() {},
        warn(message: string) {
          warns.push(message);
        },
        error() {},
        debug() {},
      },
    });

    expect(result.logs).toHaveLength(0);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("page-scan budget");
  });

  it("throws when the bearer secret is missing", async () => {
    const failingFetch = asFetch(async () => new Response("{}"));
    const executor = createK8sEventsPullExecutor({
      fetchImpl: failingFetch,
      lookupFn: publicLookup,
      now: NOW,
    });
    await expect(
      executor.execute({
        config: { apiServerUrl: "https://k8s.example" },
        fetchSecret: async () => undefined,
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toThrow(/missing bearerToken/);
  });
});
