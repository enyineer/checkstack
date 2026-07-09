import { describe, it, expect, mock } from "bun:test";
import { createHealthCheckRouter } from "./router";
import { createMockRpcContext } from "@checkstack/backend-api";
import { call } from "@orpc/server";
import { createStubHealthCheckCache } from "./cache-test-stub";

/**
 * Router-level tests for the atomic create+assign path and the
 * `notificationPolicy` forwarding regression. They use a capturing DB so the
 * exact insert values reaching the database can be asserted (the bug being
 * guarded was the `associateSystem` handler silently dropping
 * `input.body.notificationPolicy`).
 */

const passthroughCache = createStubHealthCheckCache();

const mockUser = {
  type: "user" as const,
  id: "test-user",
  accessRules: ["*"],
  roles: ["admin"],
};

interface CapturedInsert {
  values: Record<string, unknown>;
}

/**
 * A DB that records every `.values(...)` payload. Supports the chains the
 * service uses: `insert().values().returning()`,
 * `insert().values().onConflictDoUpdate()`, a bare awaited
 * `insert().values()`, and `transaction(fn)` (createAndAssign).
 */
function createCapturingDb(captured: CapturedInsert[]) {
  const insert = () => ({
    values: (values: Record<string, unknown>) => {
      captured.push({ values });
      return Object.assign(Promise.resolve(undefined), {
        onConflictDoUpdate: () => Promise.resolve(undefined),
        onConflictDoNothing: () => Promise.resolve(undefined),
        returning: () =>
          Promise.resolve([
            {
              id: "cfg-new",
              paused: false,
              createdAt: new Date(),
              updatedAt: new Date(),
              collectors: null,
              ...values,
            },
          ]),
      });
    },
  });
  const emptyWhere = Object.assign(Promise.resolve([]), {
    where: () => Promise.resolve([]),
  });
  return {
    insert,
    select: () => ({ from: () => emptyWhere }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ insert }),
  };
}

interface SignalBroadcast {
  signalId: string;
  payload: Record<string, unknown>;
}

function buildRouter(
  captured: CapturedInsert[],
  broadcasts?: SignalBroadcast[],
) {
  const signalService = broadcasts
    ? ({
        broadcast: (
          signal: { id: string },
          payload: Record<string, unknown>,
        ) => {
          broadcasts.push({ signalId: signal.id, payload });
          return Promise.resolve();
        },
      } as never)
    : undefined;
  return createHealthCheckRouter({
    database: createCapturingDb(captured) as never,
    registry: { getStrategy: mock(() => undefined) } as never,
    collectorRegistry: { getCollector: mock(() => undefined) } as never,
    gitOpsClient: {
      getProvenance: mock(() => Promise.resolve(null)),
    } as never,
    signalService,
    getEmitHook: () => undefined,
    cache: passthroughCache,
    configService: {
      get: mock(async () => undefined),
      set: mock(async () => {}),
    } as never,
    catalogClient: { getSystem: mock(async () => null) } as never,
    maintenanceClient: {
      hasActiveMaintenance: mock(async () => ({ active: false })),
    } as never,
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    } as never,
  });
}

const policy = { suppressDeEscalations: true };
const CONFIG_ID = "12345678-1234-4234-8234-123456789012";

describe("associateSystem notificationPolicy forwarding (regression)", () => {
  it("passes the per-assignment notificationPolicy through to the DB write", async () => {
    const captured: CapturedInsert[] = [];
    const router = buildRouter(captured);
    const context = createMockRpcContext({ user: mockUser });

    await call(
      router.associateSystem,
      {
        systemId: "sys-1",
        body: {
          configurationId: CONFIG_ID,
          enabled: false, // skip scheduling; we only assert the persisted row
          includeLocal: true,
          notificationPolicy: policy,
        },
      },
      { context },
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].values.notificationPolicy).toEqual(policy);
    expect(captured[0].values.systemId).toBe("sys-1");
  });
});

describe("createAndAssign router handler", () => {
  it("atomically writes the config AND the assignment, forwarding policy + env fan-out", async () => {
    const captured: CapturedInsert[] = [];
    const router = buildRouter(captured);
    const context = createMockRpcContext({ user: mockUser });

    const result = await call(
      router.createAndAssign,
      {
        systemId: "sys-1",
        configuration: {
          name: "Payments API root",
          strategyId: "healthcheck-http.http",
          config: { url: "https://api.example.com/healthz" },
          intervalSeconds: 60,
        },
        enabled: false,
        includeLocal: true,
        environmentIds: null,
        notificationPolicy: policy,
      },
      { context },
    );

    // Two writes: the config row, then the assignment row.
    expect(captured).toHaveLength(2);
    const configInsert = captured.find(
      (c) => c.values.name === "Payments API root",
    );
    const assignmentInsert = captured.find(
      (c) => c.values.configurationId !== undefined,
    );
    expect(configInsert).toBeDefined();
    expect(assignmentInsert).toBeDefined();
    expect(assignmentInsert?.values.systemId).toBe("sys-1");
    expect(assignmentInsert?.values.notificationPolicy).toEqual(policy);
    // null environmentIds = fan out to all of the system's environments.
    expect(assignmentInsert?.values.environmentIds).toBeNull();
    // Returns the created configuration.
    expect(result.name).toBe("Payments API root");
    // The id is generated up front (SEC-1: needed to key extracted secrets
    // before insert), persisted on the config row, and used to link the
    // assignment - so all three must agree.
    expect(configInsert?.values.id).toBe(result.id);
    expect(assignmentInsert?.values.configurationId).toBe(result.id);
  });

  it("broadcasts healthcheck.config.changed so open clients refresh", async () => {
    const captured: CapturedInsert[] = [];
    const broadcasts: SignalBroadcast[] = [];
    const router = buildRouter(captured, broadcasts);
    const context = createMockRpcContext({ user: mockUser });

    await call(
      router.createAndAssign,
      {
        systemId: "sys-1",
        configuration: {
          name: "Payments API root",
          strategyId: "healthcheck-http.http",
          config: { url: "https://api.example.com/healthz" },
          intervalSeconds: 60,
        },
        enabled: false,
        includeLocal: true,
        environmentIds: null,
      },
      { context },
    );

    const change = broadcasts.find(
      (b) => b.signalId === "healthcheck.config.changed",
    );
    expect(change).toBeDefined();
    expect(change?.payload.entity).toBe("assignment");
    expect(change?.payload.systemId).toBe("sys-1");
  });
});
