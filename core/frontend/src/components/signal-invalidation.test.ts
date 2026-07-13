import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  createSignal,
  signalScopeMeta,
  type Signal,
} from "@checkstack/signal-common";
import type { PluginMetadata } from "@checkstack/common";
import {
  invalidationBucketKey,
  queryMatchesResource,
  resolveSignalResourceId,
  type QueryScopeView,
} from "./signal-invalidation";

const pluginMetadata: PluginMetadata = { pluginId: "logstream" };

const RESOURCE_SIGNAL = createSignal({
  pluginMetadata,
  event: "activity",
  payloadSchema: z.object({ streamId: z.string() }),
  resourceKey: (payload) => payload.streamId,
});

const BLANKET_SIGNAL = createSignal({
  pluginMetadata,
  event: "reindexed",
  payloadSchema: z.object({ total: z.number() }),
});

/** A query hash as TanStack serializes an oRPC key `[path, { input, type }]`. */
function hashFor(input: Record<string, unknown>): string {
  return JSON.stringify([["logstream", "getStream"], { input, type: "query" }]);
}

describe("resolveSignalResourceId", () => {
  it("returns undefined for a signal with no resourceKey (blanket)", () => {
    expect(
      resolveSignalResourceId({
        signal: BLANKET_SIGNAL,
        payload: { total: 3 },
      }),
    ).toBeUndefined();
  });

  it("returns undefined when the signal is unknown to the registry", () => {
    expect(
      resolveSignalResourceId({ signal: undefined, payload: { streamId: "x" } }),
    ).toBeUndefined();
  });

  it("extracts the resource id when the signal declares a resourceKey", () => {
    expect(
      resolveSignalResourceId({
        signal: RESOURCE_SIGNAL,
        payload: { streamId: "stream-abc" },
      }),
    ).toBe("stream-abc");
  });

  it("falls back to blanket when the extractor yields an empty/missing id", () => {
    expect(
      resolveSignalResourceId({ signal: RESOURCE_SIGNAL, payload: {} }),
    ).toBeUndefined();
    expect(
      resolveSignalResourceId({
        signal: RESOURCE_SIGNAL,
        payload: { streamId: "" },
      }),
    ).toBeUndefined();
  });

  it("falls back to blanket when the extractor throws on a malformed payload", () => {
    const throwing = createSignal({
      pluginMetadata,
      event: "boom",
      payloadSchema: z.unknown(),
      resourceKey: () => {
        throw new Error("bad payload");
      },
    });
    expect(
      resolveSignalResourceId({ signal: throwing, payload: null }),
    ).toBeUndefined();
  });
});

describe("invalidationBucketKey", () => {
  it("keys blanket jobs on pluginId alone", () => {
    expect(invalidationBucketKey({ pluginId: "logstream" })).toBe("logstream");
  });

  it("gives each resource of a plugin its own bucket, distinct from blanket", () => {
    const a = invalidationBucketKey({ pluginId: "logstream", resourceId: "a" });
    const b = invalidationBucketKey({ pluginId: "logstream", resourceId: "b" });
    const blanket = invalidationBucketKey({ pluginId: "logstream" });
    expect(new Set([a, b, blanket]).size).toBe(3);
  });
});

describe("queryMatchesResource", () => {
  const resourceId = "stream-abc";

  it("invalidates a query whose key contains the resource id", () => {
    const query: QueryScopeView = { queryHash: hashFor({ streamId: resourceId }) };
    expect(queryMatchesResource({ query, resourceId })).toBe(true);
  });

  it("spares a query for a different resource", () => {
    const query: QueryScopeView = {
      queryHash: hashFor({ streamId: "stream-other" }),
    };
    expect(queryMatchesResource({ query, resourceId })).toBe(false);
  });

  it("invalidates a meta opt-in query even without the id in its key", () => {
    const query: QueryScopeView = {
      queryHash: JSON.stringify([["logstream", "listStreams"], { type: "query" }]),
      meta: { ...signalScopeMeta },
    };
    expect(queryMatchesResource({ query, resourceId })).toBe(true);
  });

  it("spares a resource-agnostic query that did not opt in", () => {
    const query: QueryScopeView = {
      queryHash: JSON.stringify([["logstream", "listStreams"], { type: "query" }]),
    };
    expect(queryMatchesResource({ query, resourceId })).toBe(false);
  });

  it("ignores an unrelated meta value", () => {
    const query: QueryScopeView = {
      queryHash: hashFor({ streamId: "stream-other" }),
      meta: { signalScope: "something-else" },
    };
    expect(queryMatchesResource({ query, resourceId })).toBe(false);
  });
});

/**
 * The end-to-end decision the task describes: given a signal + payload + a set
 * of cached queries, which queries invalidate. Composes the pure helpers the
 * same way {@link SignalAutoInvalidator} does.
 */
describe("selecting invalidated queries (integration of the pure helpers)", () => {
  interface FakeQuery {
    name: string;
    view: QueryScopeView;
  }

  // Realistic UUID-shaped ids (the production case) - no accidental substring
  // collision with the "logstream"/"getStream" path segments.
  const ID_A = "11111111-1111-4111-8111-111111111111";
  const ID_B = "22222222-2222-4222-8222-222222222222";

  const queries: FakeQuery[] = [
    { name: "detail-a", view: { queryHash: hashFor({ streamId: ID_A }) } },
    { name: "detail-b", view: { queryHash: hashFor({ streamId: ID_B }) } },
    {
      name: "list-optin",
      view: {
        queryHash: JSON.stringify([["logstream", "listStreams"], { type: "query" }]),
        meta: { ...signalScopeMeta },
      },
    },
    {
      name: "list-plain",
      view: {
        queryHash: JSON.stringify([
          ["logstream", "listPlain"],
          { type: "query" },
        ]),
      },
    },
  ];

  function selectFor(
    payload: unknown,
    signal: Signal<unknown> = RESOURCE_SIGNAL,
  ): string[] {
    const resourceId = resolveSignalResourceId({ signal, payload });
    if (resourceId === undefined) {
      // Blanket => every query of the plugin.
      return queries.map((q) => q.name);
    }
    return queries
      .filter((q) => queryMatchesResource({ query: q.view, resourceId }))
      .map((q) => q.name);
  }

  it("resource signal invalidates only the matching detail + meta opt-in", () => {
    expect(selectFor({ streamId: ID_A }).sort()).toEqual([
      "detail-a",
      "list-optin",
    ]);
  });

  it("resource signal for the other stream spares the first stream's detail", () => {
    expect(selectFor({ streamId: ID_B }).sort()).toEqual([
      "detail-b",
      "list-optin",
    ]);
  });

  it("blanket signal invalidates everything", () => {
    expect(selectFor({ total: 1 }, BLANKET_SIGNAL).sort()).toEqual(
      ["detail-a", "detail-b", "list-optin", "list-plain"].sort(),
    );
  });
});
