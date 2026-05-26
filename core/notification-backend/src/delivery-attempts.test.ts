import { describe, it, expect, mock } from "bun:test";
import { call } from "@orpc/server";
import { createMockRpcContext } from "@checkstack/backend-api";
import type { Logger, NotificationSendContext } from "@checkstack/backend-api";
import { ORPCError } from "@orpc/server";
import {
  dispatchWithAttempt,
  recordDeliveryAttempt,
  type SendableStrategy,
} from "./delivery-attempts";
import { createNotificationRouter } from "./router";
import * as schema from "./schema";

/**
 * Tests for Phase 8 delivery-attempt tracking.
 *
 * Covers:
 *   - Successful + failed strategy dispatch populates the right row shape.
 *   - The insert is best-effort - a thrown DB error MUST NOT propagate.
 *   - `getDeliveryAttempts` paginated read shape (items / total / limit / offset).
 *   - `getDeliveryAttempts` `notificationId` filter applied vs omitted.
 *   - `getDeliveryAttempts` FORBIDDEN without the `notification:manage`
 *     access rule (contract-level enforcement, not a client gate).
 */

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface CapturedInsert {
  table: unknown;
  values: Array<Record<string, unknown>>;
}

/**
 * Minimal `.insert(table).values(rows)` chain used by the delivery
 * attempts code. Captures each insert so tests can assert the persisted
 * row shape without standing up a real Drizzle client.
 */
function createInsertCapturingDb({
  insertThrows = false,
}: { insertThrows?: boolean } = {}) {
  const inserts: CapturedInsert[] = [];
  const insert = mock((table: unknown) => ({
    values: mock(async (values: Record<string, unknown>) => {
      if (insertThrows) {
        throw new Error("simulated DB write failure");
      }
      inserts.push({ table, values: [values] });
      return undefined;
    }),
  }));
  return { inserts, db: { insert } };
}

function makeLogger(): Logger & { error: ReturnType<typeof mock> } {
  return {
    info: mock(),
    error: mock(),
    warn: mock(),
    debug: mock(),
  };
}

// `NotificationSendContext` is a wide structural type; for the dispatch
// helper tests the actual contents don't matter - only the `send` shape
// does. Casting an empty object via `unknown` keeps the test focused
// without leaning on `any`.
const emptySendContext =
  {} as unknown as NotificationSendContext<unknown, unknown, unknown>;

// ---------------------------------------------------------------------------
// recordDeliveryAttempt + dispatchWithAttempt
// ---------------------------------------------------------------------------

describe("recordDeliveryAttempt", () => {
  it("inserts the row verbatim on the happy path", async () => {
    const { inserts, db } = createInsertCapturingDb();
    const logger = makeLogger();

    await recordDeliveryAttempt({
      database: db as never,
      logger,
      row: {
        notificationId: "00000000-0000-4000-8000-000000000001",
        strategyQualifiedId: "notification-discord.send",
        status: "success",
        errorMessage: null,
        durationMs: 42,
      },
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0].values[0]).toEqual({
      notificationId: "00000000-0000-4000-8000-000000000001",
      strategyQualifiedId: "notification-discord.send",
      status: "success",
      errorMessage: null,
      durationMs: 42,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("swallows DB errors so dispatch is not blocked", async () => {
    const { db } = createInsertCapturingDb({ insertThrows: true });
    const logger = makeLogger();

    // Must not reject - the best-effort guarantee is the whole point.
    await recordDeliveryAttempt({
      database: db as never,
      logger,
      row: {
        notificationId: "00000000-0000-4000-8000-000000000002",
        strategyQualifiedId: "notification-slack.send",
        status: "failure",
        errorMessage: "boom",
        durationMs: 7,
      },
    });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message] = logger.error.mock.calls[0] as [string, unknown];
    expect(message).toContain("Failed to persist delivery attempt");
    expect(message).toContain("notification-slack.send");
  });
});

describe("dispatchWithAttempt", () => {
  it("records a success row with non-negative durationMs when the strategy resolves with success", async () => {
    const { inserts, db } = createInsertCapturingDb();
    const logger = makeLogger();
    const strategy: SendableStrategy = {
      qualifiedId: "notification-test.send",
      send: mock(async () => ({ success: true })),
    };

    await dispatchWithAttempt({
      database: db as never,
      logger,
      strategy,
      sendContext: emptySendContext,
      notificationId: "00000000-0000-4000-8000-000000000003",
    });

    expect(inserts).toHaveLength(1);
    const row = inserts[0].values[0];
    expect(row.status).toBe("success");
    expect(row.errorMessage).toBeNull();
    expect(row.strategyQualifiedId).toBe("notification-test.send");
    expect(row.notificationId).toBe("00000000-0000-4000-8000-000000000003");
    expect(typeof row.durationMs).toBe("number");
    expect(row.durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it("records a failure row using extractErrorMessage when the strategy throws", async () => {
    const { inserts, db } = createInsertCapturingDb();
    const logger = makeLogger();
    const strategy: SendableStrategy = {
      qualifiedId: "notification-discord.send",
      send: mock(async () => {
        throw new Error("invalid webhook URL");
      }),
    };

    await dispatchWithAttempt({
      database: db as never,
      logger,
      strategy,
      sendContext: emptySendContext,
      notificationId: "00000000-0000-4000-8000-000000000004",
    });

    expect(inserts).toHaveLength(1);
    const row = inserts[0].values[0];
    expect(row.status).toBe("failure");
    // `extractErrorMessage(Error("invalid webhook URL")) === "invalid webhook URL"`
    expect(row.errorMessage).toBe("invalid webhook URL");
    expect(row.strategyQualifiedId).toBe("notification-discord.send");
    expect(logger.error).toHaveBeenCalled();
  });

  it("records a failure row when the strategy resolves with `{ success: false }`", async () => {
    const { inserts, db } = createInsertCapturingDb();
    const logger = makeLogger();
    const strategy: SendableStrategy = {
      qualifiedId: "notification-smtp.send",
      send: mock(async () => ({ success: false, error: "smtp rejected" })),
    };

    await dispatchWithAttempt({
      database: db as never,
      logger,
      strategy,
      sendContext: emptySendContext,
      notificationId: "00000000-0000-4000-8000-000000000005",
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0].values[0].status).toBe("failure");
    expect(inserts[0].values[0].errorMessage).toBe("smtp rejected");
  });

  it("does not propagate when the delivery-attempt insert itself fails", async () => {
    const { db } = createInsertCapturingDb({ insertThrows: true });
    const logger = makeLogger();
    const strategy: SendableStrategy = {
      qualifiedId: "notification-test.send",
      send: mock(async () => ({ success: true })),
    };

    // The dispatch helper MUST NOT reject - the dispatch loop relies
    // on this as the "best-effort" contract.
    await dispatchWithAttempt({
      database: db as never,
      logger,
      strategy,
      sendContext: emptySendContext,
      notificationId: "00000000-0000-4000-8000-000000000006",
    });

    // The inner `recordDeliveryAttempt` logged the swallowed error.
    expect(logger.error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getDeliveryAttempts read procedure
// ---------------------------------------------------------------------------

const ATTEMPTED_AT_FIXTURE = new Date("2026-05-26T12:00:00Z");

const SAMPLE_ROWS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    notificationId: "22222222-2222-4222-8222-222222222222",
    strategyQualifiedId: "notification-discord.send",
    attemptedAt: ATTEMPTED_AT_FIXTURE,
    status: "failure" as const,
    errorMessage: "invalid webhook URL",
    durationMs: 87,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    notificationId: "44444444-4444-4444-8444-444444444444",
    strategyQualifiedId: "notification-smtp.send",
    attemptedAt: ATTEMPTED_AT_FIXTURE,
    status: "success" as const,
    errorMessage: null,
    durationMs: 21,
  },
];

interface SelectRecorder {
  whereCalls: number;
  rows: ReadonlyArray<unknown>;
  totalRows: ReadonlyArray<{ value: number }>;
}

/**
 * Builds the chained `.select().from().orderBy().limit().offset()`
 * thenable expected by `getDeliveryAttempts`. The `totalQuery` branch
 * uses `.select({ value: count() }).from(...).where?(...)` -> array of
 * `{ value: number }` to match Drizzle's count idiom.
 *
 * We don't validate the actual SQL composition (Drizzle covers that);
 * we only verify the handler maps results to the contract output shape
 * and threads pagination + the optional `where` filter correctly.
 */
function createSelectMockDb({
  rows,
  totalRows,
}: {
  rows: ReadonlyArray<unknown>;
  totalRows: ReadonlyArray<{ value: number }>;
}): { db: unknown; recorder: SelectRecorder } {
  const recorder: SelectRecorder = {
    whereCalls: 0,
    rows,
    totalRows,
  };

  type Branch = "rows" | "total";
  const branchData = (branch: Branch): unknown =>
    branch === "rows" ? rows : totalRows;

  const buildThenable = (branch: Branch) => {
    const thenable = {
      where: mock(() => {
        recorder.whereCalls += 1;
        return Promise.resolve(branchData(branch));
      }),
      then: (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(branchData(branch)).then(onFulfilled, onRejected),
    };
    return thenable;
  };

  const buildFromChain = (branch: Branch) => {
    const offsetReturn = buildThenable(branch);
    const limitReturn = {
      offset: mock(() => offsetReturn),
      where: offsetReturn.where,
      then: offsetReturn.then,
    };
    const orderByReturn = {
      limit: mock(() => limitReturn),
      where: offsetReturn.where,
      then: offsetReturn.then,
    };
    const fromReturn = {
      orderBy: mock(() => orderByReturn),
      where: offsetReturn.where,
      then: offsetReturn.then,
    };
    return { from: mock(() => fromReturn) };
  };

  const db = {
    // Drizzle's `.select()` and `.select({...})` both reach here; we
    // disambiguate the count branch by inspecting the argument shape.
    select: mock((projection?: unknown) => {
      const branch: Branch = projection ? "total" : "rows";
      return buildFromChain(branch);
    }),
  };

  return { db, recorder };
}

// Lazily-evaluated factory for the router under test. Every test gets a
// fresh db + recorder so per-test mock state stays isolated.
function buildRouterForGetDeliveryAttempts({
  rows,
  totalRows,
}: {
  rows: ReadonlyArray<unknown>;
  totalRows: ReadonlyArray<{ value: number }>;
}) {
  const { db, recorder } = createSelectMockDb({ rows, totalRows });

  // The router constructor wires several services we never reach from
  // `getDeliveryAttempts` (signalService, strategyRegistry, rpcApi,
  // cache, configService). We pass minimal mocks; any access from this
  // procedure would surface as an obvious test failure.
  const router = createNotificationRouter(
    db as never,
    {} as never, // configService
    {} as never, // signalService
    { getStrategies: () => [] } as never, // strategyRegistry
    { forPlugin: () => ({}) } as never, // rpcApi
    makeLogger() as never,
    {} as never, // cache
  );

  return { router, recorder };
}

describe("getDeliveryAttempts", () => {
  const adminUser = {
    type: "user" as const,
    id: "admin-user",
    accessRules: ["notification.notification.manage"],
  };

  it("returns the canonical { items, total, limit, offset } envelope", async () => {
    const { router } = buildRouterForGetDeliveryAttempts({
      rows: SAMPLE_ROWS,
      totalRows: [{ value: 2 }],
    });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: adminUser,
    });

    const result = await call(
      router.getDeliveryAttempts,
      { limit: 20, offset: 0 },
      { context },
    );

    expect(result.total).toBe(2);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.items).toHaveLength(2);
    // Each item carries through the projected columns; verify the
    // strategy id + status pair so we know the mapper isn't dropping
    // rows.
    expect(result.items.map((i) => i.strategyQualifiedId).sort()).toEqual([
      "notification-discord.send",
      "notification-smtp.send",
    ]);
    expect(
      result.items.find((i) => i.strategyQualifiedId === "notification-smtp.send")
        ?.status,
    ).toBe("success");
  });

  it("does not apply a `where` clause when no notificationId filter is supplied", async () => {
    const { router, recorder } = buildRouterForGetDeliveryAttempts({
      rows: SAMPLE_ROWS,
      totalRows: [{ value: 2 }],
    });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: adminUser,
    });

    await call(
      router.getDeliveryAttempts,
      { limit: 20, offset: 0 },
      { context },
    );

    expect(recorder.whereCalls).toBe(0);
  });

  it("applies the notificationId filter to both the rows query and the count query", async () => {
    const filtered = [SAMPLE_ROWS[0]];
    const { router, recorder } = buildRouterForGetDeliveryAttempts({
      rows: filtered,
      totalRows: [{ value: 1 }],
    });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: adminUser,
    });

    const result = await call(
      router.getDeliveryAttempts,
      {
        limit: 20,
        offset: 0,
        notificationId: "22222222-2222-4222-8222-222222222222",
      },
      { context },
    );

    // Both the rows and the total queries should have called `.where`
    // - that's how `notificationId` propagates into the SQL.
    expect(recorder.whereCalls).toBe(2);
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].notificationId).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("throws FORBIDDEN when the caller lacks the notification:manage access rule", async () => {
    const { router } = buildRouterForGetDeliveryAttempts({
      rows: [],
      totalRows: [{ value: 0 }],
    });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: {
        type: "user" as const,
        id: "regular-user",
        accessRules: [], // no admin rule
      },
    });

    let caught: unknown;
    try {
      await call(
        router.getDeliveryAttempts,
        { limit: 20, offset: 0 },
        { context },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ORPCError);
    expect((caught as ORPCError<string, unknown>).code).toBe("FORBIDDEN");
  });
});
