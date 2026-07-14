import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { createMockLogger } from "@checkstack/test-utils-backend";
import type { EventBus, HookUnsubscribe } from "@checkstack/backend-api";
import {
  createListenerManager,
  type ListenerRow,
  type ListenerStore,
} from "./listeners";
import type { SourceSecretStore } from "./secrets";
import {
  createTelemetrySourceRegistry,
  defineTelemetrySourceType,
  type TelemetryListenerContext,
  type TelemetrySinkRegistry,
  type TelemetrySourceRegistry,
} from "./extension-points";

const passthroughSecrets: SourceSecretStore = {
  apply: async () => {},
  clearAll: async () => {},
  resolve: async ({ config }) => config,
  resolveField: async () => undefined,
  setWebhookSecret: async () => {},
  resolveWebhookSecret: async () => undefined,
  clearWebhookSecret: async () => {},
};

const emptySinks: TelemetrySinkRegistry = {
  register: () => {},
  get: () => undefined,
  list: () => [],
};

/** A listener type whose start/stop are counted; `onStart` can throw. */
function registryWith(
  counters: { starts: number; stops: number },
  onStart?: (ctx: TelemetryListenerContext) => void,
): TelemetrySourceRegistry {
  const registry = createTelemetrySourceRegistry();
  registry.register(
    defineTelemetrySourceType({
      id: "syslog",
      displayName: "Syslog",
      description: "",
      signals: ["logs"],
      configSchema: z.object({}),
      listener: {
        start: async (ctx) => {
          onStart?.(ctx);
          counters.starts += 1;
          return () => {
            counters.stops += 1;
          };
        },
      },
    }),
    { pluginId: "p" },
  );
  // A pull-only type, to prove non-listener instances are skipped.
  registry.register(
    defineTelemetrySourceType({
      id: "poller",
      displayName: "Poller",
      description: "",
      signals: ["logs"],
      configSchema: z.object({}),
      pull: { defaultIntervalSeconds: 60, minIntervalSeconds: 30, execute: async () => {} },
    }),
    { pluginId: "p" },
  );
  return registry;
}

function row(overrides: Partial<ListenerRow> = {}): ListenerRow {
  return {
    id: "src-1",
    sourceTypeId: "p.syslog",
    enabled: true,
    config: {},
    bindings: [{ signal: "logs", streamId: "stream-1" }],
    ...overrides,
  };
}

/** Mutable in-memory store + captured markFailure calls. */
function fakeStore(rows: ListenerRow[]): {
  store: ListenerStore;
  map: Map<string, ListenerRow>;
  failures: string[];
} {
  const map = new Map(rows.map((r) => [r.id, r]));
  const failures: string[] = [];
  return {
    map,
    failures,
    store: {
      listStartable: async () => [...map.values()].filter((r) => r.enabled),
      get: async (id) => map.get(id) ?? null,
      markFailure: async ({ sourceId }) => void failures.push(sourceId),
    },
  };
}

/** EventBus fake that captures the subscribed handler for manual delivery. */
function fakeEventBus(): {
  bus: EventBus;
  deliver: (sourceId: string) => Promise<void>;
  unsubscribed: () => boolean;
} {
  let handler:
    | ((payload: { sourceId: string; reason: string }) => Promise<void>)
    | null = null;
  let didUnsub = false;
  const bus = {
    subscribe: async (
      _pluginId: string,
      _hook: unknown,
      h: (payload: { sourceId: string; reason: string }) => Promise<void>,
    ): Promise<HookUnsubscribe> => {
      handler = h;
      return async () => {
        didUnsub = true;
      };
    },
    emit: async () => {},
    emitLocal: async () => {},
  } as unknown as EventBus;
  return {
    bus,
    deliver: async (sourceId) => handler?.({ sourceId, reason: "updated" }),
    unsubscribed: () => didUnsub,
  };
}

function manager({
  rows,
  counters,
  bus,
  onStart,
}: {
  rows: ListenerRow[];
  counters: { starts: number; stops: number };
  bus?: EventBus;
  onStart?: (ctx: TelemetryListenerContext) => void;
}) {
  const { store, map, failures } = fakeStore(rows);
  const mgr = createListenerManager({
    store,
    sourceRegistry: registryWith(counters, onStart),
    sinkRegistry: emptySinks,
    secretStore: passthroughSecrets,
    eventBus: bus,
    logger: createMockLogger(),
  });
  return { mgr, map, failures };
}

describe("ListenerManager", () => {
  it("starts enabled listener instances on boot and skips others", async () => {
    const counters = { starts: 0, stops: 0 };
    const { mgr } = manager({
      counters,
      rows: [
        row({ id: "a" }),
        row({ id: "b", enabled: false }),
        row({ id: "c", sourceTypeId: "p.poller" }),
      ],
    });
    await mgr.start();
    expect(counters.starts).toBe(1);
  });

  it("reconciles a config change by restarting (stop then start)", async () => {
    const counters = { starts: 0, stops: 0 };
    const { mgr } = manager({ counters, rows: [row({ id: "a" })] });
    await mgr.start();
    expect(counters.starts).toBe(1);
    await mgr.reconcileSource({ sourceId: "a" });
    expect(counters.stops).toBe(1);
    expect(counters.starts).toBe(2);
  });

  it("stops a listener when its source is disabled", async () => {
    const counters = { starts: 0, stops: 0 };
    const { mgr, map } = manager({ counters, rows: [row({ id: "a" })] });
    await mgr.start();
    map.set("a", row({ id: "a", enabled: false }));
    await mgr.reconcileSource({ sourceId: "a" });
    expect(counters.stops).toBe(1);
    expect(counters.starts).toBe(1);
  });

  it("stops a listener when its source is deleted", async () => {
    const counters = { starts: 0, stops: 0 };
    const { mgr, map } = manager({ counters, rows: [row({ id: "a" })] });
    await mgr.start();
    map.delete("a");
    await mgr.reconcileSource({ sourceId: "a" });
    expect(counters.stops).toBe(1);
  });

  it("records a start failure without throwing", async () => {
    const counters = { starts: 0, stops: 0 };
    const { mgr, failures } = manager({
      counters,
      rows: [row({ id: "a" })],
      onStart: () => {
        throw new Error("EADDRINUSE");
      },
    });
    await mgr.start();
    expect(failures).toEqual(["a"]);
    expect(counters.starts).toBe(0);
  });

  it("converges via the source-changed hook and unsubscribes on stop", async () => {
    const counters = { starts: 0, stops: 0 };
    const { bus, deliver, unsubscribed } = fakeEventBus();
    const { mgr, map } = manager({ counters, rows: [], bus });
    await mgr.start();
    expect(counters.starts).toBe(0);

    // A new enabled listener appears; the hook drives its start on this pod.
    map.set("a", row({ id: "a" }));
    await deliver("a");
    expect(counters.starts).toBe(1);

    await mgr.stop();
    expect(counters.stops).toBe(1);
    expect(unsubscribed()).toBe(true);
  });
});
