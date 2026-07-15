import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type { EventBus, HookUnsubscribe } from "@checkstack/backend-api";
import type {
  NormalizedMetricPoint,
  TelemetrySignal,
} from "@checkstack/telemetry-common";
import {
  createDeriveDispatcher,
  createDeriveTapPoint,
  type DeriveRow,
  type DeriveStore,
} from "./derive";
import {
  createTelemetrySinkRegistry,
  createTelemetrySourceRegistry,
  defineTelemetrySourceType,
  type TelemetryDeriveDispatch,
  type TelemetrySinkContribution,
  type TelemetrySourceRegistry,
} from "./extension-points";
import type { SourceSecretStore } from "./secrets";

const passthroughSecrets: SourceSecretStore = {
  apply: async () => {},
  clearAll: async () => {},
  resolve: async ({ config }) => config,
  resolveField: async () => undefined,
  setWebhookSecret: async () => {},
  resolveWebhookSecret: async () => undefined,
  clearWebhookSecret: async () => {},
};

/** A derive type emitting one metric point; `shouldThrow` fails its process. */
function registry(): TelemetrySourceRegistry {
  const reg = createTelemetrySourceRegistry();
  reg.register(
    defineTelemetrySourceType({
      id: "echo",
      displayName: "Echo",
      description: "",
      signals: ["metrics"],
      configSchema: z.object({
        inputStreamId: z.string(),
        shouldThrow: z.boolean().optional(),
      }),
      derive: {
        fromSignal: "logs",
        getInputStreamId: (c) => c.inputStreamId,
        process: async ({ config, sink }) => {
          if (config.shouldThrow) throw new Error("boom");
          const point: NormalizedMetricPoint = {
            name: "derived",
            type: "counter",
            counterKind: "delta",
            labels: {},
            value: 1,
            ts: new Date(0),
          };
          await sink.emit("metrics", [point]);
        },
      },
    }),
    { pluginId: "test" },
  );
  return reg;
}

/** A metrics sink capturing every write, so we can assert emits landed. */
function capturingSinks() {
  const writes: { streamId: string; count: number }[] = [];
  const sinks = createTelemetrySinkRegistry();
  const sink: TelemetrySinkContribution<"metrics"> = {
    signal: "metrics",
    assertBindable: async () => {},
    describeStream: async () => null,
    write: async ({ streamId, records }) => {
      writes.push({ streamId, count: records.length });
      return { accepted: records.length, rejected: 0 };
    },
  };
  sinks.register(sink, { pluginId: "metricstream" });
  return { sinks, writes };
}

function drow(overrides: Partial<DeriveRow> = {}): DeriveRow {
  return {
    id: "d1",
    sourceTypeId: "test.echo",
    enabled: true,
    config: { inputStreamId: "logs-1" },
    bindings: [{ signal: "metrics", streamId: "metrics-1" }],
    ...overrides,
  };
}

function fakeStore(rows: DeriveRow[]): {
  store: DeriveStore;
  map: Map<string, DeriveRow>;
  successes: string[];
  failures: { sourceId: string; error: string }[];
} {
  const map = new Map(rows.map((r) => [r.id, r]));
  const successes: string[] = [];
  const failures: { sourceId: string; error: string }[] = [];
  return {
    map,
    successes,
    failures,
    store: {
      listEnabled: async () => [...map.values()].filter((r) => r.enabled),
      markSuccess: async ({ sourceId }) => void successes.push(sourceId),
      markFailure: async ({ sourceId, error }) =>
        void failures.push({ sourceId, error }),
    },
  };
}

function fakeEventBus(): {
  bus: EventBus;
  deliver: () => Promise<void>;
  unsubscribed: () => boolean;
} {
  let handler: ((payload: unknown) => Promise<void>) | null = null;
  let didUnsub = false;
  const bus = {
    subscribe: async (
      _plugin: string,
      _hook: unknown,
      h: (payload: unknown) => Promise<void>,
    ): Promise<HookUnsubscribe> => {
      handler = h;
      return async () => void (didUnsub = true);
    },
    emit: async () => {},
    emitLocal: async () => {},
  } as unknown as EventBus;
  return {
    bus,
    deliver: async () => handler?.({ sourceId: "x", reason: "updated" }),
    unsubscribed: () => didUnsub,
  };
}

function dispatcher(rows: DeriveRow[], bus?: EventBus) {
  const { store, map, successes, failures } = fakeStore(rows);
  const { sinks, writes } = capturingSinks();
  const d = createDeriveDispatcher({
    store,
    sourceRegistry: registry(),
    sinkRegistry: sinks,
    secretStore: passthroughSecrets,
    eventBus: bus,
    logger: createMockLogger(),
  });
  return { d, map, successes, failures, writes };
}

const logsBatch = { streamId: "logs-1", records: [{ ts: new Date(0), body: "x" }] };

describe("createDeriveDispatcher", () => {
  it("matches by fromSignal input stream and emits through the bound sink", async () => {
    const { d, writes } = dispatcher([
      drow({ id: "match", config: { inputStreamId: "logs-1" } }),
      drow({ id: "other", config: { inputStreamId: "logs-2" } }),
    ]);
    await d.dispatchForSignal("logs")(logsBatch);
    expect(writes).toEqual([{ streamId: "metrics-1", count: 1 }]);
  });

  it("does nothing for an empty batch", async () => {
    const { d, writes } = dispatcher([drow()]);
    await d.dispatchForSignal("logs")({ streamId: "logs-1", records: [] });
    expect(writes).toHaveLength(0);
  });

  it("isolates a per-source failure and records lastError", async () => {
    const { d, failures, writes } = dispatcher([
      drow({ id: "bad", config: { inputStreamId: "logs-1", shouldThrow: true } }),
      drow({ id: "good", config: { inputStreamId: "logs-1" } }),
    ]);
    await d.dispatchForSignal("logs")(logsBatch);
    expect(failures.map((f) => f.sourceId)).toEqual(["bad"]);
    expect(failures[0]!.error).toContain("boom");
    // The healthy source still emitted.
    expect(writes).toEqual([{ streamId: "metrics-1", count: 1 }]);
  });

  it("clears the failure on recovery (markSuccess) exactly once", async () => {
    const { d, map, successes } = dispatcher([
      drow({ id: "s", config: { inputStreamId: "logs-1", shouldThrow: true } }),
    ]);
    await d.dispatchForSignal("logs")(logsBatch);
    // Flip to healthy and re-dispatch: cache still holds the row, so drive via a
    // fresh dispatcher would re-read; here we mutate the row object in place.
    map.get("s")!.config = { inputStreamId: "logs-1" };
    d.invalidate();
    await d.dispatchForSignal("logs")(logsBatch);
    expect(successes).toEqual(["s"]);
  });

  it("rebuilds the cache when the reconcile hook fires", async () => {
    const { bus, deliver } = fakeEventBus();
    const { d, map, writes } = dispatcher([], bus);
    await d.start();
    // First dispatch: no sources.
    await d.dispatchForSignal("logs")(logsBatch);
    expect(writes).toHaveLength(0);
    // A derive source appears; the hook invalidates the pod-local cache.
    map.set("new", drow({ id: "new", config: { inputStreamId: "logs-1" } }));
    await deliver();
    await d.dispatchForSignal("logs")(logsBatch);
    expect(writes).toEqual([{ streamId: "metrics-1", count: 1 }]);
    await d.stop();
  });

  it("does not adopt a stale snapshot when invalidated mid-build", async () => {
    // A store whose FIRST listEnabled blocks on a gate, so we can invalidate
    // (and change the row set) WHILE the initial build is in flight.
    let rows: DeriveRow[] = [
      drow({ id: "old", config: { inputStreamId: "logs-1" } }),
    ];
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let firstRead = true;
    const store: DeriveStore = {
      listEnabled: async () => {
        if (firstRead) {
          firstRead = false;
          await gate;
        }
        return rows.filter((r) => r.enabled);
      },
      markSuccess: async () => {},
      markFailure: async () => {},
    };
    const { sinks, writes } = capturingSinks();
    const d = createDeriveDispatcher({
      store,
      sourceRegistry: registry(),
      sinkRegistry: sinks,
      secretStore: passthroughSecrets,
      logger: createMockLogger(),
    });

    // Kick off a dispatch; its build blocks in listEnabled at the gate.
    const inflight = d.dispatchForSignal("logs")(logsBatch);
    await Promise.resolve();
    // A source CRUD lands mid-build: the row is re-pointed to logs-2.
    rows = [drow({ id: "new", config: { inputStreamId: "logs-2" } })];
    d.invalidate();
    // Let the stale build finish; it must NOT wedge the cache with the old rows.
    releaseGate();
    await inflight;
    writes.length = 0;

    // The NEXT dispatch reflects the POST-CRUD rows: the re-pointed instance no
    // longer derives from logs-1, so a logs-1 batch produces nothing...
    await d.dispatchForSignal("logs")(logsBatch);
    expect(writes).toEqual([]);
    // ...and a logs-2 batch now produces the derived write.
    await d.dispatchForSignal("logs")({
      streamId: "logs-2",
      records: [{ ts: new Date(0), body: "x" }],
    });
    expect(writes).toEqual([{ streamId: "metrics-1", count: 1 }]);
  });

  it("never materializes the records thunk when no instance matches", async () => {
    const { d, writes } = dispatcher([
      drow({ config: { inputStreamId: "logs-1" } }),
    ]);
    const throwingThunk = () => {
      throw new Error("thunk must not be called for an unmatched stream");
    };
    await d.dispatchForSignal("logs")({
      streamId: "logs-UNMATCHED",
      records: throwingThunk,
    });
    expect(writes).toHaveLength(0);
  });

  it("materializes the records thunk exactly once when an instance matches", async () => {
    const { d, writes } = dispatcher([
      drow({ config: { inputStreamId: "logs-1" } }),
    ]);
    let calls = 0;
    const thunk = () => {
      calls += 1;
      return [{ ts: new Date(0), body: "x" }];
    };
    await d.dispatchForSignal("logs")({ streamId: "logs-1", records: thunk });
    expect(calls).toBe(1);
    expect(writes).toEqual([{ streamId: "metrics-1", count: 1 }]);
  });

  it("caches: a second dispatch does not re-query the store", async () => {
    const { store, map } = fakeStore([drow()]);
    let listCalls = 0;
    const countingStore: DeriveStore = {
      listEnabled: async () => {
        listCalls += 1;
        return store.listEnabled();
      },
      markSuccess: store.markSuccess,
      markFailure: store.markFailure,
    };
    const { sinks } = capturingSinks();
    const d = createDeriveDispatcher({
      store: countingStore,
      sourceRegistry: registry(),
      sinkRegistry: sinks,
      secretStore: passthroughSecrets,
      logger: createMockLogger(),
    });
    void map;
    await d.dispatchForSignal("logs")(logsBatch);
    await d.dispatchForSignal("logs")(logsBatch);
    expect(listCalls).toBe(1);
  });
});

describe("createDeriveTapPoint", () => {
  it("buffers connectTap until activated, then resolves later taps immediately", () => {
    const tap = createDeriveTapPoint();
    const received: TelemetrySignal[] = [];
    // Registered BEFORE activation -> buffered.
    tap.point.connectTap(
      { signal: "logs", onReady: () => received.push("logs") },
      { pluginId: "logstream" },
    );
    expect(received).toHaveLength(0);

    const resolve = (signal: TelemetrySignal): TelemetryDeriveDispatch => {
      void signal;
      return async () => {};
    };
    tap.activate(resolve);
    expect(received).toEqual(["logs"]);

    // Registered AFTER activation -> resolves immediately.
    tap.point.connectTap(
      { signal: "metrics", onReady: () => received.push("metrics") },
      { pluginId: "metricstream" },
    );
    expect(received).toEqual(["logs", "metrics"]);
  });
});
