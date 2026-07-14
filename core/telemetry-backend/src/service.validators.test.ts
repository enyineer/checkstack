import { describe, it, expect } from "bun:test";
import { ORPCError } from "@orpc/server";
import type { AuthUser } from "@checkstack/backend-api";
import { createMockLogger } from "@checkstack/test-utils-backend";
import {
  assertBindingsAuthorized,
  assertSignalsSubset,
  enrichBindingStreamNames,
  resolveBindableStreams,
} from "./service";
import type {
  RegisteredTelemetrySink,
  TelemetrySinkRegistry,
} from "./extension-points";
import type {
  SourceBinding,
  TelemetrySignal,
  TelemetrySource,
} from "@checkstack/telemetry-common";

const user: AuthUser = { type: "user", id: "u1", accessRules: [] };

function sinkRegistry({
  assertBindable = async () => {},
  listBindableStreams,
}: {
  assertBindable?: RegisteredTelemetrySink["assertBindable"];
  listBindableStreams?: RegisteredTelemetrySink["listBindableStreams"];
} = {}): TelemetrySinkRegistry {
  const logsSink: RegisteredTelemetrySink = {
    signal: "logs",
    ownerPluginId: "logstream",
    assertBindable,
    describeStream: async () => null,
    write: async () => ({ accepted: 0, rejected: 0 }),
    ...(listBindableStreams ? { listBindableStreams } : {}),
  };
  return {
    register: () => {},
    get: (signal) => (signal === "logs" ? logsSink : undefined),
    list: () => [logsSink],
  };
}

describe("assertSignalsSubset", () => {
  it("passes when every binding signal is emittable", () => {
    expect(() =>
      assertSignalsSubset({
        type: { signals: ["logs", "metrics"] },
        bindings: [{ signal: "logs", streamId: "s" }],
      }),
    ).not.toThrow();
  });

  it("rejects a signal the type cannot emit", () => {
    expect(() =>
      assertSignalsSubset({
        type: { signals: ["logs"] },
        bindings: [{ signal: "metrics", streamId: "s" }],
      }),
    ).toThrow(/does not emit signal/i);
  });
});

describe("assertBindingsAuthorized", () => {
  it("rejects a binding whose signal has no registered sink", async () => {
    await expect(
      assertBindingsAuthorized({
        bindings: [{ signal: "metrics", streamId: "s" }],
        sinkRegistry: sinkRegistry(),
        user,
      }),
    ).rejects.toThrow(/no sink for signal/i);
  });

  it("propagates assertBindable rejection (manage-on-stream denied)", async () => {
    await expect(
      assertBindingsAuthorized({
        bindings: [{ signal: "logs", streamId: "s" }],
        sinkRegistry: sinkRegistry({
          assertBindable: async () => {
            throw new ORPCError("FORBIDDEN", { message: "no manage on stream" });
          },
        }),
        user,
      }),
    ).rejects.toThrow(/FORBIDDEN|no manage/i);
  });

  it("requires a user", async () => {
    await expect(
      assertBindingsAuthorized({
        bindings: [{ signal: "logs", streamId: "s" }],
        sinkRegistry: sinkRegistry(),
        user: undefined,
      }),
    ).rejects.toThrow(/UNAUTHORIZED|Authentication/i);
  });

  it("passes when every binding is authorized", async () => {
    await expect(
      assertBindingsAuthorized({
        bindings: [{ signal: "logs", streamId: "s" }],
        sinkRegistry: sinkRegistry(),
        user,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("resolveBindableStreams", () => {
  const logger = createMockLogger();

  it("returns the sink's filtered list when it implements the lister", async () => {
    const result = await resolveBindableStreams({
      sinkRegistry: sinkRegistry({
        listBindableStreams: async () => [
          { id: "s1", name: "App logs" },
          { id: "s2", name: "Audit" },
        ],
      }),
      signal: "logs",
      user,
      logger,
    });
    expect(result).toEqual({
      streams: [
        { id: "s1", name: "App logs" },
        { id: "s2", name: "Audit" },
      ],
    });
  });

  it("passes the caller through to the sink for its own filtering", async () => {
    let seen: AuthUser | undefined;
    await resolveBindableStreams({
      sinkRegistry: sinkRegistry({
        listBindableStreams: async ({ user: u }) => {
          seen = u;
          return [];
        },
      }),
      signal: "logs",
      user,
      logger,
    });
    expect(seen).toBe(user);
  });

  it("returns an empty list when the sink has NOT adopted the lister", async () => {
    // sinkRegistry() builds a logs sink without listBindableStreams.
    const result = await resolveBindableStreams({
      sinkRegistry: sinkRegistry(),
      signal: "logs",
      user,
      logger,
    });
    expect(result).toEqual({ streams: [] });
  });

  it("returns an empty list when NO sink owns the signal", async () => {
    const result = await resolveBindableStreams({
      sinkRegistry: sinkRegistry({
        listBindableStreams: async () => [{ id: "s1", name: "App logs" }],
      }),
      // metrics has no sink in this registry.
      signal: "metrics",
      user,
      logger,
    });
    expect(result).toEqual({ streams: [] });
  });

  it("returns an empty list for an unauthenticated caller", async () => {
    const result = await resolveBindableStreams({
      sinkRegistry: sinkRegistry({
        listBindableStreams: async () => [{ id: "s1", name: "App logs" }],
      }),
      signal: "logs",
      user: undefined,
      logger,
    });
    expect(result).toEqual({ streams: [] });
  });
});

describe("enrichBindingStreamNames", () => {
  const logger = createMockLogger();

  /** Build a minimal source DTO with the given bindings. */
  function source(id: string, bindings: SourceBinding[]): TelemetrySource {
    return {
      id,
      sourceTypeId: "p.vendor",
      name: id,
      description: null,
      config: {},
      storedSecretFields: [],
      bindings,
      bindingStreamNames: {},
      enabled: true,
      intervalSeconds: null,
      satelliteId: null,
      lastRunAt: null,
      lastError: null,
      consecutiveFailures: 0,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  }

  /**
   * A sink registry whose per-signal sinks resolve names from a fixed map and
   * COUNT how many times `describeStreams` / `describeStream` are called.
   */
  function namingRegistry({
    names,
    signals = ["logs", "metrics"],
    batched = true,
  }: {
    names: Record<string, string>;
    signals?: TelemetrySignal[];
    /** When false, the sink omits describeStreams (forces the per-id fallback). */
    batched?: boolean;
  }): {
    registry: TelemetrySinkRegistry;
    counts: { describeStreams: number; describeStream: number };
  } {
    const counts = { describeStreams: 0, describeStream: 0 };
    const build = (signal: TelemetrySignal): RegisteredTelemetrySink => ({
      signal,
      ownerPluginId: "owner",
      assertBindable: async () => {},
      describeStream: async ({ streamId }) => {
        counts.describeStream += 1;
        const name = names[streamId];
        return name ? { id: streamId, name } : null;
      },
      ...(batched
        ? {
            describeStreams: async ({
              streamIds,
            }: {
              streamIds: string[];
            }) => {
              counts.describeStreams += 1;
              const out: Record<
                string,
                { id: string; name: string } | null
              > = {};
              for (const streamId of streamIds) {
                const name = names[streamId];
                out[streamId] = name ? { id: streamId, name } : null;
              }
              return out;
            },
          }
        : {}),
      write: async () => ({ accepted: 0, rejected: 0 }),
    });
    const sinks = new Map<TelemetrySignal, RegisteredTelemetrySink>();
    for (const signal of signals) sinks.set(signal, build(signal));
    return {
      counts,
      registry: {
        register: () => {},
        get: (signal) => sinks.get(signal),
        list: () => [...sinks.values()],
      },
    };
  }

  it("resolves names for a single source (get path)", async () => {
    const { registry } = namingRegistry({ names: { s1: "App logs" } });
    const [enriched] = await enrichBindingStreamNames({
      sources: [source("src", [{ signal: "logs", streamId: "s1" }])],
      sinkRegistry: registry,
      logger,
    });
    expect(enriched!.bindingStreamNames).toEqual({ logs: "App logs" });
  });

  it("resolves names across a whole list (list path)", async () => {
    const { registry } = namingRegistry({
      names: { s1: "App logs", s2: "Audit logs", m1: "CPU" },
    });
    const enriched = await enrichBindingStreamNames({
      sources: [
        source("a", [{ signal: "logs", streamId: "s1" }]),
        source("b", [
          { signal: "logs", streamId: "s2" },
          { signal: "metrics", streamId: "m1" },
        ]),
      ],
      sinkRegistry: registry,
      logger,
    });
    expect(enriched[0]!.bindingStreamNames).toEqual({ logs: "App logs" });
    expect(enriched[1]!.bindingStreamNames).toEqual({
      logs: "Audit logs",
      metrics: "CPU",
    });
  });

  it("batches ONE describeStreams call per signal regardless of row count", async () => {
    const { registry, counts } = namingRegistry({
      names: { s1: "L1", s2: "L2", s3: "L3", m1: "M1", m2: "M2" },
    });
    // Five sources binding logs, three also binding metrics.
    const sources = [
      source("a", [{ signal: "logs", streamId: "s1" }]),
      source("b", [
        { signal: "logs", streamId: "s2" },
        { signal: "metrics", streamId: "m1" },
      ]),
      source("c", [
        { signal: "logs", streamId: "s3" },
        { signal: "metrics", streamId: "m2" },
      ]),
      source("d", [{ signal: "logs", streamId: "s1" }]),
      source("e", [{ signal: "metrics", streamId: "m1" }]),
    ];
    await enrichBindingStreamNames({ sources, sinkRegistry: registry, logger });
    // One call for logs + one for metrics = 2, never per-row, and no per-id
    // describeStream fallback used.
    expect(counts.describeStreams).toBe(2);
    expect(counts.describeStream).toBe(0);
  });

  it("maps a deleted stream (unknown id) to null", async () => {
    const { registry } = namingRegistry({ names: { s1: "App logs" } });
    const [enriched] = await enrichBindingStreamNames({
      sources: [source("src", [{ signal: "logs", streamId: "gone" }])],
      sinkRegistry: registry,
      logger,
    });
    expect(enriched!.bindingStreamNames).toEqual({ logs: null });
  });

  it("falls back to per-id describeStream when the sink lacks the batch method", async () => {
    const { registry, counts } = namingRegistry({
      names: { s1: "App logs", s2: "Audit logs" },
      batched: false,
    });
    const enriched = await enrichBindingStreamNames({
      sources: [
        source("a", [{ signal: "logs", streamId: "s1" }]),
        source("b", [{ signal: "logs", streamId: "s2" }]),
      ],
      sinkRegistry: registry,
      logger,
    });
    expect(counts.describeStreams).toBe(0);
    // One describeStream per distinct id (grouped per signal), never batched.
    expect(counts.describeStream).toBe(2);
    expect(enriched[0]!.bindingStreamNames).toEqual({ logs: "App logs" });
    expect(enriched[1]!.bindingStreamNames).toEqual({ logs: "Audit logs" });
  });

  it("maps a signal with no registered sink to null", async () => {
    // Registry owns only logs; a metrics binding has no sink.
    const { registry } = namingRegistry({
      names: { s1: "App logs" },
      signals: ["logs"],
    });
    const [enriched] = await enrichBindingStreamNames({
      sources: [
        source("src", [
          { signal: "logs", streamId: "s1" },
          { signal: "metrics", streamId: "m1" },
        ]),
      ],
      sinkRegistry: registry,
      logger,
    });
    expect(enriched!.bindingStreamNames).toEqual({
      logs: "App logs",
      metrics: null,
    });
  });
});
