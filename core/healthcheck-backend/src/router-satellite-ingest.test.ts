import { describe, it, expect, mock } from "bun:test";
import { call } from "@orpc/server";
import { createMockRpcContext } from "@checkstack/backend-api";
import { createHealthCheckRouter } from "./router";
import { createStubHealthCheckCache } from "./cache-test-stub";
import type { HealthRunReaction } from "./queue-executor";

/**
 * A satellite result MUST drive the SAME core post-run path a local run does:
 * the reactive `health` entity write, the notification, the automation hooks,
 * etc. The router routes it there via the injected `reactToSatelliteRun`
 * reactor. These tests pin that wiring so ingest can never silently regress to
 * an insert-only path (which is what left satellite-detected outages silent).
 */

// A service principal - ingestSatelliteResult is a backend-to-backend proc.
const serviceContext = () =>
  createMockRpcContext({
    user: { type: "service", pluginId: "satellite-backend" } as never,
  });

function buildRouter(opts: {
  reactToSatelliteRun?: (run: HealthRunReaction) => Promise<void>;
  transaction?: ReturnType<typeof mock>;
}) {
  // db.select(...).from(...).where(...) resolves the config row (name +
  // collectors) that processSatelliteResult reads.
  const database = {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() =>
          Promise.resolve([{ name: "Ping", collectors: [] }]),
        ),
      })),
    })),
    transaction:
      opts.transaction ??
      mock(async () => {
        /* not expected in the reactor path */
      }),
  };

  const collectorRegistry = {
    register: mock(() => {}),
    getCollector: mock(() => undefined),
    getCollectors: mock(() => []),
  };

  const catalogClient = {
    getSystem: mock(async () => ({ id: "sys-1", name: "API Server" })),
  };

  return createHealthCheckRouter({
    database: database as never,
    registry: { getStrategy: mock(() => undefined) } as never,
    collectorRegistry: collectorRegistry as never,
    gitOpsClient: {} as never,
    getEmitHook: () => undefined,
    cache: createStubHealthCheckCache(),
    configService: {} as never,
    catalogClient: catalogClient as never,
    maintenanceClient: {} as never,
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    } as never,
    ...(opts.reactToSatelliteRun
      ? { reactToSatelliteRun: opts.reactToSatelliteRun }
      : {}),
  });
}

const ingestInput = {
  configId: "config-1",
  systemId: "sys-1",
  status: "unhealthy" as const,
  latencyMs: 123,
  result: {
    status: "unhealthy" as const,
    latencyMs: 123,
    message: "Check failed",
    metadata: { connected: true, collectors: {} },
  },
  executedAt: "2026-07-03T10:00:00.000Z",
  sourceId: "sat-eu",
  sourceLabel: "EU West",
  environmentId: "env-prod",
};

describe("ingestSatelliteResult - drives the shared post-run path", () => {
  it("routes a satellite result through reactToSatelliteRun with its processed payload", async () => {
    const runs: HealthRunReaction[] = [];
    const router = buildRouter({
      reactToSatelliteRun: async (run) => {
        runs.push(run);
      },
    });

    await call(router.ingestSatelliteResult, ingestInput, {
      context: serviceContext(),
    });

    expect(runs).toHaveLength(1);
    const run = runs[0];
    // The run carries the satellite's SOURCE + environment, and its display
    // name was resolved for the notification the shared path will send.
    expect(run.systemId).toBe("sys-1");
    expect(run.systemName).toBe("API Server");
    expect(run.configId).toBe("config-1");
    expect(run.configName).toBe("Ping");
    expect(run.environmentId).toBe("env-prod");
    expect(run.status).toBe("unhealthy");
    expect(run.sourceId).toBe("sat-eu");
    expect(run.sourceLabel).toBe("EU West");
    expect(run.runTimestamp).toEqual(new Date("2026-07-03T10:00:00.000Z"));
  });

  it("falls back to an insert-only persist when no reactor is wired", async () => {
    // Record that the insert-only fallback opened a transaction, without
    // executing its body (the aggregate internals need a full db mock and are
    // covered elsewhere); the point is that ingest still records the run.
    const transaction = mock(async () => {});
    const router = buildRouter({ transaction });

    await call(router.ingestSatelliteResult, ingestInput, {
      context: serviceContext(),
    });

    // The insert-only fallback ran (a run is still recorded), but there is no
    // reactor path to drive notifications/automations - which is exactly why
    // the real host always wires `reactToSatelliteRun`.
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
