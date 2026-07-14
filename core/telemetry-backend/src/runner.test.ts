import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { createMockLogger } from "@checkstack/test-utils-backend";
import { createPullRunner, truncateError, type PullRunRow, type PullRunStore } from "./runner";
import type { SourceSecretStore } from "./secrets";
import {
  defineTelemetrySourceType,
  type RegisteredTelemetrySourceType,
  type TelemetryPullContext,
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

const emptySinkRegistry: TelemetrySinkRegistry = {
  register: () => {},
  get: () => undefined,
  list: () => [],
};

function registryFor(
  execute: (ctx: TelemetryPullContext) => Promise<void>,
  configSchema: z.ZodType = z.object({}),
): TelemetrySourceRegistry {
  const type: RegisteredTelemetrySourceType = {
    ...defineTelemetrySourceType({
      id: "poller",
      displayName: "Poller",
      description: "",
      signals: ["logs"],
      configSchema,
      pull: { defaultIntervalSeconds: 60, minIntervalSeconds: 30, execute },
    }),
    qualifiedId: "p.poller",
    ownerPluginId: "p",
  };
  return {
    register: () => {},
    get: (id) => (id === "p.poller" ? type : undefined),
    list: () => [type],
  };
}

const row: PullRunRow = {
  id: "src-1",
  sourceTypeId: "p.poller",
  enabled: true,
  satelliteId: null,
  config: {},
  bindings: [{ signal: "logs", streamId: "stream-1" }],
};

function fakeStore(loaded: PullRunRow | null): {
  store: PullRunStore;
  calls: { success: number; failures: string[] };
} {
  const calls = { success: 0, failures: [] as string[] };
  const store: PullRunStore = {
    load: async () => loaded,
    markSuccess: async () => {
      calls.success += 1;
    },
    markFailure: async ({ error }) => {
      calls.failures.push(error);
    },
  };
  return { store, calls };
}

describe("createPullRunner", () => {
  it("marks success when execute resolves", async () => {
    const { store, calls } = fakeStore(row);
    const runner = createPullRunner({
      store,
      sourceRegistry: registryFor(async () => {}),
      sinkRegistry: emptySinkRegistry,
      secretStore: passthroughSecrets,
      logger: createMockLogger(),
    });
    await runner.run({ sourceId: "src-1" });
    expect(calls.success).toBe(1);
    expect(calls.failures).toEqual([]);
  });

  it("marks failure when execute throws", async () => {
    const { store, calls } = fakeStore(row);
    const runner = createPullRunner({
      store,
      sourceRegistry: registryFor(async () => {
        throw new Error("connection refused");
      }),
      sinkRegistry: emptySinkRegistry,
      secretStore: passthroughSecrets,
      logger: createMockLogger(),
    });
    await runner.run({ sourceId: "src-1" });
    expect(calls.success).toBe(0);
    expect(calls.failures[0]).toContain("connection refused");
  });

  it("marks a timeout failure when the run exceeds the budget", async () => {
    const { store, calls } = fakeStore(row);
    const runner = createPullRunner({
      store,
      sourceRegistry: registryFor(
        (ctx) =>
          new Promise((_resolve, reject) => {
            ctx.abortSignal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      ),
      sinkRegistry: emptySinkRegistry,
      secretStore: passthroughSecrets,
      logger: createMockLogger(),
      timeoutMs: 5,
    });
    await runner.run({ sourceId: "src-1" });
    expect(calls.failures[0]).toContain("timed out");
  });

  it("skips a disabled / gone / satellite-bound source", async () => {
    const disabled = { ...row, enabled: false };
    const { store, calls } = fakeStore(disabled);
    const runner = createPullRunner({
      store,
      sourceRegistry: registryFor(async () => {
        throw new Error("should not run");
      }),
      sinkRegistry: emptySinkRegistry,
      secretStore: passthroughSecrets,
      logger: createMockLogger(),
    });
    await runner.run({ sourceId: "src-1" });
    expect(calls.success).toBe(0);
    expect(calls.failures).toEqual([]);
  });

  it("marks failure when config resolution fails", async () => {
    const { store, calls } = fakeStore(row);
    const runner = createPullRunner({
      store,
      // Config schema requires a field the row does not provide.
      sourceRegistry: registryFor(async () => {}, z.object({ required: z.string() })),
      sinkRegistry: emptySinkRegistry,
      secretStore: passthroughSecrets,
      logger: createMockLogger(),
    });
    await runner.run({ sourceId: "src-1" });
    expect(calls.failures[0]).toContain("config resolution failed");
  });
});

describe("truncateError", () => {
  it("caps long messages", () => {
    expect(truncateError("x".repeat(3000)).length).toBeLessThanOrEqual(2001);
    expect(truncateError("short")).toBe("short");
  });
});
