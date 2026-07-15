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

/** Captured `onRunFailure` / `onRunRecovery` invocations, for hook assertions. */
interface HookCalls {
  failure: { consecutiveFailures: number; error: string; sourceName: string }[];
  recovery: { sourceName: string }[];
}

function registryFor(
  execute: (ctx: TelemetryPullContext) => Promise<void>,
  configSchema: z.ZodType = z.object({}),
  hooks?: {
    hookCalls?: HookCalls;
    onRunFailureThrows?: boolean;
    onRunRecoveryThrows?: boolean;
  },
): TelemetrySourceRegistry {
  const type: RegisteredTelemetrySourceType = {
    ...defineTelemetrySourceType({
      id: "poller",
      displayName: "Poller",
      description: "",
      signals: ["logs"],
      configSchema,
      pull: {
        defaultIntervalSeconds: 60,
        minIntervalSeconds: 30,
        execute,
        ...(hooks
          ? {
              onRunFailure: async ({
                consecutiveFailures,
                error,
                sourceName,
              }) => {
                hooks.hookCalls?.failure.push({
                  consecutiveFailures,
                  error,
                  sourceName,
                });
                if (hooks.onRunFailureThrows) throw new Error("hook boom");
              },
              onRunRecovery: async ({ sourceName }) => {
                hooks.hookCalls?.recovery.push({ sourceName });
                if (hooks.onRunRecoveryThrows) throw new Error("hook boom");
              },
            }
          : {}),
      },
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
  name: "Prod poller",
  enabled: true,
  satelliteId: null,
  config: {},
  bindings: [{ signal: "logs", streamId: "stream-1" }],
};

function fakeStore(
  loaded: PullRunRow | null,
  opts: { recovered?: boolean } = {},
): {
  store: PullRunStore;
  calls: { success: number; failures: string[]; failureCounts: number[] };
} {
  const calls = {
    success: 0,
    failures: [] as string[],
    failureCounts: [] as number[],
  };
  let consecutiveFailures = 0;
  const store: PullRunStore = {
    load: async () => loaded,
    markSuccess: async () => {
      calls.success += 1;
      return { recovered: opts.recovered ?? false };
    },
    markFailure: async ({ error }) => {
      calls.failures.push(error);
      consecutiveFailures += 1;
      calls.failureCounts.push(consecutiveFailures);
      return { consecutiveFailures };
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

  it("invokes onRunFailure with the just-stored consecutive count", async () => {
    const hookCalls: HookCalls = { failure: [], recovery: [] };
    const { store } = fakeStore(row);
    const runner = createPullRunner({
      store,
      sourceRegistry: registryFor(
        async () => {
          throw new Error("connection refused");
        },
        z.object({}),
        { hookCalls },
      ),
      sinkRegistry: emptySinkRegistry,
      secretStore: passthroughSecrets,
      logger: createMockLogger(),
    });
    await runner.run({ sourceId: "src-1" });
    expect(hookCalls.failure).toEqual([
      {
        consecutiveFailures: 1,
        error: "Error: connection refused",
        sourceName: "Prod poller",
      },
    ]);
    expect(hookCalls.recovery).toEqual([]);
  });

  it("invokes onRunRecovery exactly once when a success clears failures", async () => {
    const hookCalls: HookCalls = { failure: [], recovery: [] };
    const { store } = fakeStore(row, { recovered: true });
    const runner = createPullRunner({
      store,
      sourceRegistry: registryFor(async () => {}, z.object({}), { hookCalls }),
      sinkRegistry: emptySinkRegistry,
      secretStore: passthroughSecrets,
      logger: createMockLogger(),
    });
    await runner.run({ sourceId: "src-1" });
    expect(hookCalls.recovery).toEqual([{ sourceName: "Prod poller" }]);
    expect(hookCalls.failure).toEqual([]);
  });

  it("does not invoke onRunRecovery when the source was already healthy", async () => {
    const hookCalls: HookCalls = { failure: [], recovery: [] };
    const { store } = fakeStore(row, { recovered: false });
    const runner = createPullRunner({
      store,
      sourceRegistry: registryFor(async () => {}, z.object({}), { hookCalls }),
      sinkRegistry: emptySinkRegistry,
      secretStore: passthroughSecrets,
      logger: createMockLogger(),
    });
    await runner.run({ sourceId: "src-1" });
    expect(hookCalls.recovery).toEqual([]);
  });

  it("a throwing health hook never breaks the run flow", async () => {
    const hookCalls: HookCalls = { failure: [], recovery: [] };
    const { store, calls } = fakeStore(row);
    const runner = createPullRunner({
      store,
      sourceRegistry: registryFor(
        async () => {
          throw new Error("connection refused");
        },
        z.object({}),
        { hookCalls, onRunFailureThrows: true },
      ),
      sinkRegistry: emptySinkRegistry,
      secretStore: passthroughSecrets,
      logger: createMockLogger(),
    });
    // Must resolve without throwing even though the hook threw.
    await runner.run({ sourceId: "src-1" });
    expect(calls.failures[0]).toContain("connection refused");
    expect(hookCalls.failure).toHaveLength(1);
  });
});

describe("truncateError", () => {
  it("caps long messages", () => {
    expect(truncateError("x".repeat(3000)).length).toBeLessThanOrEqual(2001);
    expect(truncateError("short")).toBe("short");
  });
});
