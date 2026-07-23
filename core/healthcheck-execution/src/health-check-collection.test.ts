import { describe, expect, test, mock } from "bun:test";
import { z } from "zod";

import { configString } from "@checkstack/backend-api";
import {
  buildTemplateContext,
  runHealthCheckCollection,
  type CollectorOutcome,
  type HealthCheckCollectionHooks,
} from "./health-check-collection";
import type {
  CollectorRunContext,
  RegisteredCollector,
  HealthCheckStrategy,
} from "@checkstack/backend-api";

const silentLogger = {
  debug: mock(),
  info: mock(),
  warn: mock(),
  error: mock(),
} as never;

const runContext: CollectorRunContext = {
  check: { id: "cfg-1", name: "API health", intervalSeconds: 60 },
  system: { id: "sys-1", name: "API", metadata: { region: "eu-west-1" } },
  environment: {
    id: "env-prod",
    name: "Production",
    fields: { baseUrl: "https://prod.example.com" },
  },
};

/** A strategy whose config has a templatable `url` field. Records what it was
 * asked to connect with, so a test can assert the rendered value. */
function makeStrategy(): {
  strategy: HealthCheckStrategy;
  connectedWith: { value?: unknown };
  closed: { count: number };
} {
  const connectedWith: { value?: unknown } = {};
  const closed = { count: 0 };
  const strategy = {
    id: "http",
    config: {
      schema: z.object({ url: configString({ "x-templatable": true }) }),
    },
    createClient: mock(async (config: unknown) => {
      connectedWith.value = config;
      return {
        client: { kind: "fake-client" },
        close: () => {
          closed.count += 1;
        },
      };
    }),
  } as unknown as HealthCheckStrategy;
  return { strategy, connectedWith, closed };
}

/** A collector whose config has a templatable `path` field. Records the config
 * it received so a test can assert templating happened before execute. */
function makeCollector(props?: {
  execute?: (params: {
    config: unknown;
    secretEnv?: Record<string, string>;
  }) => Promise<{ result: Record<string, unknown>; error?: string }>;
}): { registered: RegisteredCollector; executedWith: { config?: unknown; secretEnv?: Record<string, string> } } {
  const executedWith: { config?: unknown; secretEnv?: Record<string, string> } = {};
  const registered = {
    qualifiedId: "http.probe",
    ownerPlugin: { pluginId: "http" },
    collector: {
      id: "probe",
      config: {
        schema: z.object({ path: configString({ "x-templatable": true }) }),
      },
      result: { schema: z.object({}) },
      execute: mock(
        async (params: {
          config: unknown;
          secretEnv?: Record<string, string>;
        }) => {
          executedWith.config = params.config;
          executedWith.secretEnv = params.secretEnv;
          if (props?.execute) return props.execute(params);
          return { result: { ok: true } };
        },
      ),
    },
  } as unknown as RegisteredCollector;
  return { registered, executedWith };
}

interface Entry {
  storageKey: string;
  config: Record<string, unknown>;
}

/** Passthrough hooks: raw config, raw result - the satellite's shape. */
function passthroughHooks(
  registered: RegisteredCollector,
  overrides?: Partial<HealthCheckCollectionHooks<Entry>>,
): HealthCheckCollectionHooks<Entry> {
  return {
    getCollector: () => registered,
    storageKeyOf: (e) => e.storageKey,
    prepareCollectorConfig: async (e) => e.config,
    mapResult: ({ entry, collectorResult }): CollectorOutcome => ({
      storageKey: entry.storageKey,
      success: !collectorResult.error,
      error: collectorResult.error,
      storedResult: {
        ...(collectorResult.result as Record<string, unknown>),
      },
    }),
    mapError: ({ entry, error }): CollectorOutcome => ({
      storageKey: entry.storageKey,
      success: false,
      error: String(error),
      storedResult: { error: String(error) },
    }),
    ...overrides,
  };
}

describe("buildTemplateContext", () => {
  test("exposes environment fields, check, and system (with metadata)", () => {
    expect(buildTemplateContext(runContext)).toEqual({
      environment: { baseUrl: "https://prod.example.com" },
      check: runContext.check,
      system: runContext.system,
    });
  });

  test("an env-less run gets an empty environment map, not undefined", () => {
    const ctx = buildTemplateContext({
      check: runContext.check,
      system: { id: "s", name: "s" },
    });
    expect(ctx.environment).toEqual({});
  });
});

describe("runHealthCheckCollection", () => {
  test("renders {{ environment.* }} in the STRATEGY config before connecting", async () => {
    const { strategy, connectedWith } = makeStrategy();
    const { registered } = makeCollector();

    await runHealthCheckCollection<Entry>({
      strategy,
      strategyConfig: { url: "{{ environment.baseUrl }}/health" },
      collectors: [],
      runContext,
      pluginId: "http",
      logger: silentLogger,
      hooks: passthroughHooks(registered),
    });

    expect(connectedWith.value).toEqual({
      url: "https://prod.example.com/health",
    });
  });

  test("renders {{ system.metadata.* }} in the COLLECTOR config before execute (the reported bug)", async () => {
    const { strategy } = makeStrategy();
    const { registered, executedWith } = makeCollector();

    const outcome = await runHealthCheckCollection<Entry>({
      strategy,
      strategyConfig: { url: "https://x" },
      collectors: [
        { storageKey: "c1", config: { path: "/{{ system.metadata.region }}" } },
      ],
      runContext,
      pluginId: "http",
      logger: silentLogger,
      hooks: passthroughHooks(registered),
    });

    // The custom-field template resolved instead of reaching the collector raw.
    expect(executedWith.config).toEqual({ path: "/eu-west-1" });
    expect(outcome.hasCollectorError).toBe(false);
    expect(outcome.collectorResults.c1).toEqual({ ok: true });
  });

  test("resolves secrets BEFORE templating and passes secretEnv to the collector", async () => {
    const order: string[] = [];
    const { strategy } = makeStrategy();
    const { registered, executedWith } = makeCollector({
      execute: async () => {
        order.push("execute");
        return { result: { ok: true } };
      },
    });

    await runHealthCheckCollection<Entry>({
      strategy,
      strategyConfig: { url: "https://x" },
      collectors: [{ storageKey: "c1", config: { path: "/x" } }],
      runContext,
      pluginId: "http",
      logger: silentLogger,
      hooks: passthroughHooks(registered, {
        resolveSecretEnv: async () => {
          order.push("secret");
          return { TOKEN: "s3cr3t" };
        },
        prepareCollectorConfig: async (e) => {
          order.push("prepare");
          return e.config;
        },
      }),
    });

    expect(order).toEqual(["secret", "prepare", "execute"]);
    expect(executedWith.secretEnv).toEqual({ TOKEN: "s3cr3t" });
  });

  test("a failing collector marks the run failed and surfaces its error", async () => {
    const { strategy } = makeStrategy();
    const { registered } = makeCollector({
      execute: async () => ({ result: {}, error: "boom" }),
    });

    const outcome = await runHealthCheckCollection<Entry>({
      strategy,
      strategyConfig: { url: "https://x" },
      collectors: [{ storageKey: "c1", config: { path: "/x" } }],
      runContext,
      pluginId: "http",
      logger: silentLogger,
      hooks: passthroughHooks(registered),
    });

    expect(outcome.hasCollectorError).toBe(true);
    expect(outcome.errorMessage).toBe("boom");
  });

  test("a thrown collector is routed through mapError, not fatal to the run", async () => {
    const { strategy } = makeStrategy();
    const { registered } = makeCollector({
      execute: async () => {
        throw new Error("kaboom");
      },
    });

    const outcome = await runHealthCheckCollection<Entry>({
      strategy,
      strategyConfig: { url: "https://x" },
      collectors: [{ storageKey: "c1", config: { path: "/x" } }],
      runContext,
      pluginId: "http",
      logger: silentLogger,
      hooks: passthroughHooks(registered),
    });

    expect(outcome.connected).toBe(true);
    expect(outcome.hasCollectorError).toBe(true);
    expect(outcome.errorMessage).toContain("kaboom");
    expect(outcome.collectorResults.c1).toEqual({ error: "Error: kaboom" });
  });

  test("a missing collector is skipped, not failed", async () => {
    const { strategy } = makeStrategy();
    const { registered } = makeCollector();

    const outcome = await runHealthCheckCollection<Entry>({
      strategy,
      strategyConfig: { url: "https://x" },
      collectors: [{ storageKey: "gone", config: {} }],
      runContext,
      pluginId: "http",
      logger: silentLogger,
      hooks: passthroughHooks(registered, { getCollector: () => undefined }),
    });

    expect(outcome.hasCollectorError).toBe(false);
    expect(outcome.collectorResults).toEqual({});
  });

  test("a failed client build reports connected:false and closes nothing", async () => {
    const { strategy, closed } = makeStrategy();
    (strategy.createClient as unknown as ReturnType<typeof mock>).mockImplementationOnce(
      async () => {
        throw new Error("connection refused");
      },
    );
    const { registered } = makeCollector();

    const outcome = await runHealthCheckCollection<Entry>({
      strategy,
      strategyConfig: { url: "https://x" },
      collectors: [{ storageKey: "c1", config: { path: "/x" } }],
      runContext,
      pluginId: "http",
      logger: silentLogger,
      hooks: passthroughHooks(registered),
    });

    expect(outcome.connected).toBe(false);
    expect(outcome.hasCollectorError).toBe(true);
    expect(outcome.errorMessage).toContain("connection refused");
    expect(closed.count).toBe(0);
  });

  test("always closes the client after a successful run", async () => {
    const { strategy, closed } = makeStrategy();
    const { registered } = makeCollector();

    await runHealthCheckCollection<Entry>({
      strategy,
      strategyConfig: { url: "https://x" },
      collectors: [{ storageKey: "c1", config: { path: "/x" } }],
      runContext,
      pluginId: "http",
      logger: silentLogger,
      hooks: passthroughHooks(registered),
    });

    expect(closed.count).toBe(1);
  });

  test("times out a hung collector and reports the failure", async () => {
    const { strategy } = makeStrategy();
    const { registered } = makeCollector({
      execute: () => new Promise(() => {}), // never resolves
    });

    const outcome = await runHealthCheckCollection<Entry>({
      strategy,
      strategyConfig: { url: "https://x" },
      collectors: [{ storageKey: "c1", config: { path: "/x" } }],
      runContext,
      pluginId: "http",
      logger: silentLogger,
      timeoutMs: 30,
      hooks: passthroughHooks(registered),
    });

    expect(outcome.hasCollectorError).toBe(true);
    expect(outcome.errorMessage).toContain("timeout");
    // The client was built before the hang, so it is reported connected.
    expect(outcome.connected).toBe(true);
  });
});
