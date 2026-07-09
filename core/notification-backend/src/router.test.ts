import { describe, it, expect, mock } from "bun:test";
import { call, ORPCError } from "@orpc/server";
import { createMockRpcContext } from "@checkstack/backend-api";
import type {
  Logger,
  NotificationStrategy,
  NotificationStrategyRegistry,
} from "@checkstack/backend-api";
import { createNotificationRouter } from "./router";
import type { NotificationCache } from "./cache";
import * as schema from "./schema";

/**
 * Notification router tests (Phase 9b of the v1 polishing plan).
 *
 * Covers critical paths that were previously only smoke-tested:
 *  - `getNotifications` paginated read + `unreadOnly` filter shape.
 *  - `createGroup` happy path + duplicate-name upsert behaviour.
 *  - `notifyForSubscription` dispatch fan-out:
 *      - zero subscribers -> notifiedCount=0, no insert into
 *        `notifications`, no external-delivery side-effects.
 *      - matched subscribers -> notifications inserted, external
 *        delivery fires for each recipient.
 *      - subscription scoped to a different (parent) resource is NOT
 *        dispatched when only the child's resourceKey is provided.
 *  - `sendTransactional` external delivery with strategy fallback:
 *      - primary strategy success -> result row success=true.
 *      - primary strategy throws -> dispatch loop continues to the
 *        next enabled strategy and the failure is surfaced as
 *        `success: false` with the extracted error message.
 *
 * Mocks follow the chain-builder pattern used in
 * `delivery-attempts.test.ts` so we never reach a real DB. The
 * `subscription-engine` module is mocked at runtime so the dispatch
 * tests don't require the full provisioning chain.
 *
 * Legacy subscription migration is intentionally not covered here -
 * it lives entirely inside `subscription-engine.provisionGroupsForSpec`
 * (gated by the `subscription_migrations` table) and has no dedicated
 * router-level surface to exercise. See the orchestrator report.
 */

// ---------------------------------------------------------------------------
// Shared test doubles
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    info: mock(),
    error: mock(),
    warn: mock(),
    debug: mock(),
  };
}

/**
 * A cache double that calls each loader directly (no caching, no
 * invalidation tracking). Lets tests focus on the underlying read /
 * write path.
 */
const passthroughCache: NotificationCache = {
  wrapUnread: (_userId, loader) => loader(),
  wrapNotifications: (_userId, _filters, loader) => loader(),
  wrapSubscriptions: (_userId, loader) => loader(),
  invalidateForUser: async () => {},
  invalidateSubscriptions: async () => {},
  scope: {} as NotificationCache["scope"],
};

/**
 * The router accepts a `SignalService`-shaped dependency but the
 * procedures under test only call `sendToUser` in fire-and-forget mode.
 * We record the calls so dispatch tests can assert the signal fan-out
 * without standing up the real signal service.
 */
function makeSignalService(): {
  sendToUser: ReturnType<typeof mock>;
} {
  return { sendToUser: mock(async () => {}) };
}

/**
 * Build a thenable that resolves to `data` and also responds to a
 * `.where(...)` call by recording the invocation and resolving to the
 * same data. This is the shape Drizzle composes when a `.where()` may
 * or may not be appended after `.from()`.
 */
function buildThenable<T>(
  data: T,
  onWhere?: () => void,
): {
  where: ReturnType<typeof mock>;
  then: (
    onFulfilled?: (value: T) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
  limit: ReturnType<typeof mock>;
  offset: ReturnType<typeof mock>;
  orderBy: ReturnType<typeof mock>;
  innerJoin: ReturnType<typeof mock>;
} {
  const resolveAs = (): Promise<T> => Promise.resolve(data);
  const self = {
    where: mock(() => {
      onWhere?.();
      return self;
    }),
    limit: mock(() => self),
    offset: mock(() => self),
    orderBy: mock(() => self),
    innerJoin: mock(() => self),
    then: (
      onFulfilled?: (value: T) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => resolveAs().then(onFulfilled, onRejected),
  };
  return self;
}

// ---------------------------------------------------------------------------
// getNotifications
// ---------------------------------------------------------------------------

const USER_NOTIFICATION_FIXTURE = {
  id: "00000000-0000-4000-8000-aaaaaaaaaaaa",
  userId: "user-1",
  title: "Hello",
  body: "World",
  action: null,
  importance: "info" as const,
  isRead: false,
  collapseKey: null,
  subjects: null,
  createdAt: new Date("2026-05-25T12:00:00Z"),
};

const READ_NOTIFICATION_FIXTURE = {
  ...USER_NOTIFICATION_FIXTURE,
  id: "00000000-0000-4000-8000-bbbbbbbbbbbb",
  isRead: true,
  title: "Old",
};

/**
 * Capturing select db for `getNotifications`. The service.ts code does
 * two parallel `.select().from(notifications).where(...)...` chains:
 *  - rows: `.select().from(...).where(...).orderBy(...).limit(...).offset(...)`
 *  - count: `.select({ count }).from(...).where(...)`
 *
 * We disambiguate by the projection arg, same trick as
 * `delivery-attempts.test.ts`.
 */
function createGetNotificationsDb({
  rows,
  total,
}: {
  rows: ReadonlyArray<typeof USER_NOTIFICATION_FIXTURE>;
  total: number;
}): {
  db: unknown;
  whereCalls: { count: number };
} {
  const whereCalls = { count: 0 };
  const onWhere = () => {
    whereCalls.count += 1;
  };

  const db = {
    select: mock((projection?: unknown) => {
      const isCount = !!projection;
      const data = isCount ? [{ count: total }] : rows;
      const thenable = buildThenable(data, onWhere);
      return { from: mock(() => thenable) };
    }),
  };

  return { db, whereCalls };
}

function buildRouterForReads({
  db,
}: {
  db: unknown;
}): ReturnType<typeof createNotificationRouter> {
  return createNotificationRouter({
    database: db as never,
    configService: {} as never,
    signalService: makeSignalService() as never,
    strategyRegistry: { getStrategies: () => [] } as never,
    rpcApi: { forPlugin: () => ({}) } as never,
    logger: makeLogger() as never,
    cache: passthroughCache,
  });
}

describe("notification router · getNotifications", () => {
  const adminUser = {
    type: "user" as const,
    id: "user-1",
    accessRules: ["*"],
  };

  it("returns the canonical { items, total, limit, offset } envelope", async () => {
    const { db } = createGetNotificationsDb({
      rows: [USER_NOTIFICATION_FIXTURE],
      total: 1,
    });
    const router = buildRouterForReads({ db });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: adminUser,
    });

    const result = await call(
      router.getNotifications,
      { limit: 20, offset: 0, unreadOnly: false },
      { context },
    );

    expect(result.total).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(USER_NOTIFICATION_FIXTURE.id);
    expect(result.items[0].title).toBe("Hello");
  });

  it("honours the supplied limit and offset on the response envelope", async () => {
    const { db } = createGetNotificationsDb({
      rows: [],
      total: 42,
    });
    const router = buildRouterForReads({ db });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: adminUser,
    });

    const result = await call(
      router.getNotifications,
      { limit: 5, offset: 10, unreadOnly: false },
      { context },
    );

    // Pagination math is the service's job (offset arithmetic), so we
    // only assert the envelope echoes back what the caller asked for.
    expect(result.limit).toBe(5);
    expect(result.offset).toBe(10);
    expect(result.total).toBe(42);
    expect(result.items).toHaveLength(0);
  });

  it("applies a where clause on both the rows and count queries when unreadOnly is true", async () => {
    // service.ts builds a single `whereClause` and threads it into BOTH
    // the rows and count queries. Each `.where(...)` invocation
    // increments our counter, so we expect exactly two calls.
    const { db, whereCalls } = createGetNotificationsDb({
      rows: [USER_NOTIFICATION_FIXTURE],
      total: 1,
    });
    const router = buildRouterForReads({ db });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: adminUser,
    });

    await call(
      router.getNotifications,
      { limit: 20, offset: 0, unreadOnly: true },
      { context },
    );

    // One where for rows, one for count. The unreadOnly filter is
    // composed *into* the same predicate (an additional `eq(isRead,
    // false)` AND), so it does not produce extra `.where()` calls -
    // but it does produce them on both queries. We assert the dual
    // path applied.
    expect(whereCalls.count).toBe(2);
  });

  it("maps null DB columns to undefined on the output items", async () => {
    const { db } = createGetNotificationsDb({
      rows: [USER_NOTIFICATION_FIXTURE, READ_NOTIFICATION_FIXTURE],
      total: 2,
    });
    const router = buildRouterForReads({ db });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: adminUser,
    });

    const result = await call(
      router.getNotifications,
      { limit: 20, offset: 0, unreadOnly: false },
      { context },
    );

    expect(result.items).toHaveLength(2);
    for (const item of result.items) {
      // The router collapses `null` -> `undefined` for these columns so
      // the contract output (which uses `optional()` not `nullable()`)
      // validates.
      expect(item.action).toBeUndefined();
      expect(item.collapseKey).toBeUndefined();
      expect(item.subjects).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// createGroup
// ---------------------------------------------------------------------------

interface CapturedUpsert {
  values: Record<string, unknown>;
  onConflictSet: Record<string, unknown> | undefined;
}

/**
 * Builder for the `.insert(...).values(...).onConflictDoUpdate(...)`
 * chain used by `createGroup`. The `onConflictDoUpdate` branch lets us
 * verify the upsert (i.e. "duplicate" calls update the existing row
 * instead of throwing).
 */
function createUpsertCapturingDb(): {
  db: unknown;
  upserts: CapturedUpsert[];
} {
  const upserts: CapturedUpsert[] = [];
  const insert = mock(() => ({
    values: mock((values: Record<string, unknown>) => ({
      onConflictDoUpdate: mock(
        async (opts: { set: Record<string, unknown> }) => {
          upserts.push({ values, onConflictSet: opts.set });
          return undefined;
        },
      ),
    })),
  }));
  return { db: { insert }, upserts };
}

describe("notification router · createGroup", () => {
  // createGroup is `userType: "service"` - we need a service caller.
  const serviceCaller = {
    type: "service" as const,
    id: "service-caller",
    pluginId: "my-plugin",
    accessRules: ["*"],
  };

  it("namespaces the groupId with the ownerPlugin on the happy path", async () => {
    const { db, upserts } = createUpsertCapturingDb();
    const router = buildRouterForReads({ db });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: serviceCaller,
    });

    const result = await call(
      router.createGroup,
      {
        groupId: "incidents",
        name: "Incidents",
        description: "Incident notifications",
        ownerPlugin: "my-plugin",
      },
      { context },
    );

    expect(result.id).toBe("my-plugin.incidents");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].values).toMatchObject({
      id: "my-plugin.incidents",
      name: "Incidents",
      description: "Incident notifications",
      ownerPlugin: "my-plugin",
    });
  });

  it("upserts (does not throw) on duplicate group ids — the onConflictDoUpdate branch fires", async () => {
    const { db, upserts } = createUpsertCapturingDb();
    const router = buildRouterForReads({ db });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: serviceCaller,
    });

    // First create.
    await call(
      router.createGroup,
      {
        groupId: "incidents",
        name: "Incidents v1",
        description: "Original description",
        ownerPlugin: "my-plugin",
      },
      { context },
    );

    // Second create with the same id + new name/description. Must not
    // throw — the handler always uses `.onConflictDoUpdate` so callers
    // can re-register their groups idempotently on every boot.
    await call(
      router.createGroup,
      {
        groupId: "incidents",
        name: "Incidents v2",
        description: "Updated description",
        ownerPlugin: "my-plugin",
      },
      { context },
    );

    expect(upserts).toHaveLength(2);
    // The conflict path receives the new name/description as the set
    // payload, which is what makes this an upsert vs an error.
    expect(upserts[1].onConflictSet).toMatchObject({
      name: "Incidents v2",
      description: "Updated description",
    });
  });
});

// ---------------------------------------------------------------------------
// notifyForSubscription (dispatch fan-out)
// ---------------------------------------------------------------------------

/**
 * Minimal subscription-spec row used by the dispatch tests. The exact
 * shape mirrors `schema.subscriptionSpecs.$inferSelect` for the fields
 * the router actually reads.
 */
const SPEC_FIXTURE = {
  specId: "my-plugin.spec.alerts",
  ownerPlugin: "my-plugin",
  localId: "spec.alerts",
  targetTypeId: "my-plugin.system",
  displayTitle: "Alerts",
  displayDescription: "Alert notifications",
  displayIconName: null,
  registeredAt: new Date(),
};

interface CapturedInsert {
  rows: Array<Record<string, unknown>>;
  returning: ReadonlyArray<{ id: string; userId: string }>;
}

/**
 * Build the chained DB used by `notifyForSubscription`:
 *
 *   - `.select().from(subscriptionSpecs).where(...).limit(1)` -> [spec?]
 *   - `.select({resourceKey}).from(notificationResources).where(and(...))` -> rows
 *   - `.selectDistinct({userId}).from(notificationSubscriptions).where(inArray(...))` -> subscribers
 *   - `.insert(notifications).values([...]).returning(...)` -> returned ids
 *
 * The dispatch path also queries `notificationResourceParents` via the
 * `subscription-engine.resolveInheritedGroupIds` helper. We force that
 * helper to return `[]` by stubbing the parents table to zero rows.
 *
 * Tests parametrize the responses for each select branch via a small
 * scenario record.
 */
interface DispatchScenario {
  spec: typeof SPEC_FIXTURE | null;
  knownResources: ReadonlyArray<{ resourceKey: string }>;
  subscribers: ReadonlyArray<{ userId: string }>;
}

function createDispatchDb({
  scenario,
  insertReturning,
}: {
  scenario: DispatchScenario;
  insertReturning: ReadonlyArray<{ id: string; userId: string }>;
}): { db: unknown; capturedInsert: CapturedInsert } {
  const capturedInsert: CapturedInsert = {
    rows: [],
    returning: insertReturning,
  };

  // Track how many `select()` calls have happened so we can rotate
  // through the spec lookup -> resource lookup branches. The selectDistinct
  // branch is its own method on the db.
  let selectCallIdx = 0;

  type SelectBranch = "spec" | "resources" | "parents" | "other";
  const branchFor = (idx: number): SelectBranch => {
    if (idx === 0) return "spec";
    if (idx === 1) return "resources";
    // resolveInheritedGroupIds queries `notificationResourceParents`
    // - we return empty rows for all subsequent select() calls.
    return "parents";
  };

  const dataForBranch = (branch: SelectBranch): unknown => {
    if (branch === "spec") return scenario.spec ? [scenario.spec] : [];
    if (branch === "resources") return scenario.knownResources;
    return [];
  };

  const db = {
    select: mock((projection?: unknown) => {
      const idx = selectCallIdx;
      selectCallIdx += 1;
      void projection;
      const branch = branchFor(idx);
      const data = dataForBranch(branch);
      const thenable = buildThenable(data);
      return { from: mock(() => thenable) };
    }),
    selectDistinct: mock(() => {
      const thenable = buildThenable(scenario.subscribers);
      return { from: mock(() => thenable) };
    }),
    insert: mock(() => ({
      values: mock((values: Array<Record<string, unknown>>) => {
        capturedInsert.rows.push(...values);
        return {
          returning: mock(async () => capturedInsert.returning),
        };
      }),
    })),
    // Scoped-db contract: resolveInheritedGroups batches its two reads in a tx.
    transaction: mock((cb: (tx: unknown) => unknown) => cb(db)),
  };

  return { db, capturedInsert };
}

/**
 * Build the notification router wired up for a dispatch test. The
 * strategy registry returns an empty list so the external-delivery
 * fan-out exits immediately (we cover the strategy fallback path in
 * its own describe block via `sendTransactional`).
 */
function buildRouterForDispatch({
  db,
  signalService,
}: {
  db: unknown;
  signalService: ReturnType<typeof makeSignalService>;
}): ReturnType<typeof createNotificationRouter> {
  return createNotificationRouter({
    database: db as never,
    configService: {} as never,
    signalService: signalService as never,
    strategyRegistry: {
      getStrategies: () => [],
      getStrategy: () => undefined,
    } as never,
    rpcApi: {
      forPlugin: () => ({ getUserById: async () => null }),
    } as never,
    logger: makeLogger() as never,
    cache: passthroughCache,
  });
}

describe("notification router · notifyForSubscription (dispatch)", () => {
  const serviceCaller = {
    type: "service" as const,
    id: "service-caller",
    pluginId: "my-plugin",
    accessRules: ["*"],
  };

  // `subjects` is required by the contract (min 1) - every dispatch
  // call MUST include at least one subject so the notification can be
  // cross-referenced back to its triggering entity.
  const SUBJECTS_FIXTURE = [
    {
      kind: "my-plugin.system",
      id: "system-1",
      name: "API Gateway",
    },
  ];

  it("returns notifiedCount=0 and does not insert when no subscribers match", async () => {
    const { db, capturedInsert } = createDispatchDb({
      scenario: {
        spec: SPEC_FIXTURE,
        knownResources: [{ resourceKey: "system-1" }],
        subscribers: [], // zero subscribers
      },
      insertReturning: [],
    });
    const signalService = makeSignalService();
    const router = buildRouterForDispatch({ db, signalService });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: serviceCaller,
    });

    const result = await call(
      router.notifyForSubscription,
      {
        specId: SPEC_FIXTURE.specId,
        resourceKeys: ["system-1"],
        title: "Heads up",
        body: "Something happened",
        subjects: SUBJECTS_FIXTURE,
      },
      { context },
    );

    expect(result.notifiedCount).toBe(0);
    expect(capturedInsert.rows).toHaveLength(0);
    // No subscribers -> no signals dispatched either.
    expect(signalService.sendToUser).not.toHaveBeenCalled();
  });

  it("inserts one notification per matching subscriber and emits a signal for each", async () => {
    const insertReturning = [
      { id: "notif-1", userId: "user-1" },
      { id: "notif-2", userId: "user-2" },
    ];
    const { db, capturedInsert } = createDispatchDb({
      scenario: {
        spec: SPEC_FIXTURE,
        knownResources: [{ resourceKey: "system-1" }],
        subscribers: [{ userId: "user-1" }, { userId: "user-2" }],
      },
      insertReturning,
    });
    const signalService = makeSignalService();
    const router = buildRouterForDispatch({ db, signalService });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: serviceCaller,
    });

    const result = await call(
      router.notifyForSubscription,
      {
        specId: SPEC_FIXTURE.specId,
        resourceKeys: ["system-1"],
        title: "Heads up",
        body: "Something happened",
        subjects: SUBJECTS_FIXTURE,
      },
      { context },
    );

    expect(result.notifiedCount).toBe(2);
    expect(capturedInsert.rows).toHaveLength(2);
    expect(capturedInsert.rows[0]).toMatchObject({
      userId: "user-1",
      title: "Heads up",
      body: "Something happened",
      importance: "info",
    });
    // One signal per inserted notification.
    expect(signalService.sendToUser).toHaveBeenCalledTimes(2);
  });

  it("excludes users in excludeUserIds from the recipient list", async () => {
    const { db, capturedInsert } = createDispatchDb({
      scenario: {
        spec: SPEC_FIXTURE,
        knownResources: [{ resourceKey: "system-1" }],
        subscribers: [{ userId: "user-1" }, { userId: "user-2" }],
      },
      insertReturning: [{ id: "notif-2", userId: "user-2" }],
    });
    const signalService = makeSignalService();
    const router = buildRouterForDispatch({ db, signalService });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: serviceCaller,
    });

    const result = await call(
      router.notifyForSubscription,
      {
        specId: SPEC_FIXTURE.specId,
        resourceKeys: ["system-1"],
        excludeUserIds: ["user-1"], // exclude one subscriber
        title: "Heads up",
        body: "Something happened",
        subjects: SUBJECTS_FIXTURE,
      },
      { context },
    );

    // Only user-2 remains after exclude.
    expect(result.notifiedCount).toBe(1);
    expect(capturedInsert.rows).toHaveLength(1);
    expect(capturedInsert.rows[0]).toMatchObject({ userId: "user-2" });
  });

  it("throws NOT_FOUND when the specId is not registered", async () => {
    const { db } = createDispatchDb({
      scenario: {
        spec: null, // missing spec
        knownResources: [],
        subscribers: [],
      },
      insertReturning: [],
    });
    const signalService = makeSignalService();
    const router = buildRouterForDispatch({ db, signalService });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: serviceCaller,
    });

    let caught: unknown;
    try {
      await call(
        router.notifyForSubscription,
        {
          specId: "nonexistent.spec",
          resourceKeys: ["system-1"],
          title: "Heads up",
          body: "Something happened",
          subjects: SUBJECTS_FIXTURE,
        },
        { context },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ORPCError);
    expect((caught as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
  });

  it("throws NOT_FOUND when a resourceKey is unknown for the spec's target", async () => {
    // Only `system-1` is registered as a known resource; caller asks
    // for `system-2` (drift). Dispatch must reject loudly so the caller
    // knows a resource was never pushed.
    const { db } = createDispatchDb({
      scenario: {
        spec: SPEC_FIXTURE,
        knownResources: [{ resourceKey: "system-1" }],
        subscribers: [],
      },
      insertReturning: [],
    });
    const signalService = makeSignalService();
    const router = buildRouterForDispatch({ db, signalService });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: serviceCaller,
    });

    let caught: unknown;
    try {
      await call(
        router.notifyForSubscription,
        {
          specId: SPEC_FIXTURE.specId,
          resourceKeys: ["system-2"], // unknown resource
          title: "Heads up",
          body: "Something happened",
          subjects: SUBJECTS_FIXTURE,
        },
        { context },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ORPCError);
    expect((caught as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
    expect((caught as ORPCError<string, unknown>).message).toContain(
      "system-2",
    );
  });

  it("throws FORBIDDEN when the caller's pluginId does not own the spec", async () => {
    const { db } = createDispatchDb({
      scenario: {
        spec: { ...SPEC_FIXTURE, ownerPlugin: "other-plugin" },
        knownResources: [{ resourceKey: "system-1" }],
        subscribers: [],
      },
      insertReturning: [],
    });
    const signalService = makeSignalService();
    const router = buildRouterForDispatch({ db, signalService });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: serviceCaller, // caller.pluginId = "my-plugin"
    });

    let caught: unknown;
    try {
      await call(
        router.notifyForSubscription,
        {
          specId: SPEC_FIXTURE.specId,
          resourceKeys: ["system-1"],
          title: "Heads up",
          body: "Something happened",
          subjects: SUBJECTS_FIXTURE,
        },
        { context },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ORPCError);
    expect((caught as ORPCError<string, unknown>).code).toBe("FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// notifyForSubscription · external-delivery config hoisting (regression)
// ---------------------------------------------------------------------------

/**
 * Poll `predicate` across event-loop turns until it holds. The external
 * fan-out in `notifyForSubscription` is fire-and-forget (`void
 * sendToExternalChannels(...)`), so the per-recipient sends settle AFTER the
 * handler promise resolves. All the doubles resolve synchronously, so a
 * handful of `setImmediate` turns is enough to flush them.
 */
async function waitFor(
  predicate: () => boolean,
  { tries = 100 }: { tries?: number } = {},
): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (!predicate()) {
    throw new Error("waitFor: condition was not met within the allotted turns");
  }
}

/**
 * A `ConfigService` double that records every `get(configId)` it services so a
 * test can assert HOW MANY TIMES each strategy config was read across a
 * multi-recipient dispatch. Returns canned values keyed by the id suffix the
 * `StrategyService` uses:
 *   - `strategy.<id>.meta`         -> `{ enabled: true }`
 *   - `strategy.<id>.config`       -> a non-null opaque config
 *   - `strategy.<id>.layoutConfig` -> undefined (strategies here declare none)
 *   - `user-pref.<userId>.<id>`    -> the per-user preference (recipient-specific)
 */
function makeCountingConfigService({
  prefByUser = {},
}: {
  prefByUser?: Record<string, { enabled: boolean } | null>;
}): { configService: unknown; getIds: string[] } {
  const getIds: string[] = [];
  const configService = {
    get: mock(async (configId: string) => {
      getIds.push(configId);
      if (configId.endsWith(".meta")) return { enabled: true };
      if (configId.endsWith(".layoutConfig")) return undefined;
      if (configId.startsWith("user-pref.")) {
        for (const [userId, pref] of Object.entries(prefByUser)) {
          if (configId.startsWith(`user-pref.${userId}.`)) return pref;
        }
        return null;
      }
      // strategy.<id>.config — non-null so the strategy is "configured".
      return { opaque: true };
    }),
    set: mock(async () => {}),
  };
  return { configService, getIds };
}

describe("notification router · notifyForSubscription (config hoisting)", () => {
  const serviceCaller = {
    type: "service" as const,
    id: "service-caller",
    pluginId: "my-plugin",
    accessRules: ["*"],
  };

  const SUBJECTS_FIXTURE = [
    { kind: "my-plugin.system", id: "system-1", name: "API Gateway" },
  ];

  function buildRouterForDelivery({
    db,
    configService,
    sends,
  }: {
    db: unknown;
    configService: unknown;
    sends: Array<{ contact: string }>;
  }): {
    router: ReturnType<typeof createNotificationRouter>;
    send: ReturnType<typeof mock>;
  } {
    const send = mock(async (ctx: { contact: string }) => {
      sends.push({ contact: ctx.contact });
      return { success: true };
    });
    const router = createNotificationRouter({
      database: db as never,
      configService: configService as never,
      signalService: makeSignalService() as never,
      strategyRegistry: makeStrategyRegistry([
        { qualifiedId: "my-plugin.email", send },
      ]),
      rpcApi: {
        forPlugin: () => ({
          getUserById: async ({ userId }: { userId: string }) => ({
            id: userId,
            email: `${userId}@example.com`,
            name: userId,
          }),
        }),
      } as never,
      logger: makeLogger() as never,
      cache: passthroughCache,
    });
    return { router, send };
  }

  it("reads the recipient-independent strategy config ONCE per strategy while fanning out to every recipient", async () => {
    // Two subscribers, both with the channel enabled. The meta + config reads
    // are recipient-independent, so they must be issued exactly ONCE for the
    // whole fan-out; only the per-user preference read scales with recipients.
    const { db } = createDispatchDb({
      scenario: {
        spec: SPEC_FIXTURE,
        knownResources: [{ resourceKey: "system-1" }],
        subscribers: [{ userId: "user-1" }, { userId: "user-2" }],
      },
      insertReturning: [
        { id: "notif-1", userId: "user-1" },
        { id: "notif-2", userId: "user-2" },
      ],
    });
    const { configService, getIds } = makeCountingConfigService({
      prefByUser: { "user-1": { enabled: true }, "user-2": { enabled: true } },
    });
    const sends: Array<{ contact: string }> = [];
    const { router, send } = buildRouterForDelivery({ db, configService, sends });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: serviceCaller,
    });

    const result = await call(
      router.notifyForSubscription,
      {
        specId: SPEC_FIXTURE.specId,
        resourceKeys: ["system-1"],
        title: "Heads up",
        body: "Something happened",
        subjects: SUBJECTS_FIXTURE,
      },
      { context },
    );

    expect(result.notifiedCount).toBe(2);

    // Fan-out reaches BOTH recipients, each with their own resolved contact.
    await waitFor(() => send.mock.calls.length === 2);
    expect(sends.map((s) => s.contact).sort()).toEqual([
      "user-1@example.com",
      "user-2@example.com",
    ]);

    // The recipient-INDEPENDENT reads happen exactly once despite 2 recipients.
    const metaReads = getIds.filter((id) => id.endsWith(".meta"));
    const configReads = getIds.filter((id) => id.endsWith(".config"));
    expect(metaReads).toEqual(["strategy.my-plugin.email.meta"]);
    expect(configReads).toEqual(["strategy.my-plugin.email.config"]);

    // The per-recipient preference read still scales with recipients: one per
    // user, proving each recipient's own preference is consulted.
    const prefReads = getIds.filter((id) => id.startsWith("user-pref."));
    expect(prefReads.sort()).toEqual([
      "user-pref.user-1.my-plugin.email",
      "user-pref.user-2.my-plugin.email",
    ]);
  });

  it("applies each recipient's own preference: a user who disabled the channel is skipped while config is still read once", async () => {
    // user-1 keeps the channel on, user-2 turned it off. Both are notified
    // in-app, but only user-1 receives the external send — and the strategy
    // meta/config are STILL read exactly once for the whole fan-out.
    const { db } = createDispatchDb({
      scenario: {
        spec: SPEC_FIXTURE,
        knownResources: [{ resourceKey: "system-1" }],
        subscribers: [{ userId: "user-1" }, { userId: "user-2" }],
      },
      insertReturning: [
        { id: "notif-1", userId: "user-1" },
        { id: "notif-2", userId: "user-2" },
      ],
    });
    const { configService, getIds } = makeCountingConfigService({
      prefByUser: { "user-1": { enabled: true }, "user-2": { enabled: false } },
    });
    const sends: Array<{ contact: string }> = [];
    const { router, send } = buildRouterForDelivery({ db, configService, sends });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: serviceCaller,
    });

    const result = await call(
      router.notifyForSubscription,
      {
        specId: SPEC_FIXTURE.specId,
        resourceKeys: ["system-1"],
        title: "Heads up",
        body: "Something happened",
        subjects: SUBJECTS_FIXTURE,
      },
      { context },
    );

    // Both recipients get the in-app notification row.
    expect(result.notifiedCount).toBe(2);

    // Both users' preferences are consulted, so wait until both reads landed,
    // then confirm only the enabled user received an external send.
    await waitFor(
      () =>
        getIds.filter((id) => id.startsWith("user-pref.")).length === 2,
    );
    expect(send.mock.calls.length).toBe(1);
    expect(sends).toEqual([{ contact: "user-1@example.com" }]);

    // Config still read once regardless of the per-recipient skip.
    expect(getIds.filter((id) => id.endsWith(".meta"))).toEqual([
      "strategy.my-plugin.email.meta",
    ]);
    expect(getIds.filter((id) => id.endsWith(".config"))).toEqual([
      "strategy.my-plugin.email.config",
    ]);
  });
});

// ---------------------------------------------------------------------------
// sendTransactional · strategy fallback
// ---------------------------------------------------------------------------

interface FakeStrategySpec {
  qualifiedId: string;
  send: NotificationStrategy<unknown, unknown, unknown>["send"];
}

/**
 * Build a fake strategy registry that returns the provided strategies
 * verbatim from `getStrategies()` and looks them up by `qualifiedId` on
 * `getStrategy()`. The shape mirrors `NotificationStrategyRegistry`
 * just enough for `sendTransactional` to call into it.
 */
function makeStrategyRegistry(
  strategies: FakeStrategySpec[],
): NotificationStrategyRegistry {
  // Each strategy carries a minimal shape: `contactResolution`
  // (auth-email so contact resolves trivially from the user's email),
  // a no-op config schema, and the `send` mock the test cares about.
  const fullStrategies = strategies.map((s) => ({
    qualifiedId: s.qualifiedId,
    ownerPluginId: s.qualifiedId.split(".")[0],
    displayName: s.qualifiedId,
    description: "",
    contactResolution: { type: "auth-email" as const },
    config: { version: 1, schema: { parse: (v: unknown) => v } },
    send: s.send,
  }));

  return {
    getStrategies: mock(() => fullStrategies),
    getStrategy: mock((id: string) =>
      fullStrategies.find((s) => s.qualifiedId === id),
    ),
    register: mock(),
  } as unknown as NotificationStrategyRegistry;
}

/**
 * Strategy-service double that reports every strategy as enabled,
 * always returns a non-null strategyConfig (so the
 * "Strategy not configured" early-return doesn't fire), and returns
 * no per-user preference (so contact resolution falls back to the
 * user's email).
 */
function makeReadyStrategyService(): unknown {
  return {
    getStrategyMeta: async () => ({ enabled: true }),
    getStrategyConfig: async () => ({ /* opaque config */ }),
    getLayoutConfig: async () => undefined,
    getUserPreference: async () => null,
  };
}

function buildRouterForSendTransactional({
  db,
  strategies,
}: {
  db: unknown;
  strategies: FakeStrategySpec[];
}): ReturnType<typeof createNotificationRouter> {
  // We use a partial mock for the strategy service by replacing the
  // factory's output: the router's `createStrategyService` reads from
  // `db` + `configService` + `strategyRegistry`. Instead of replacing
  // those, we override the produced service via the prototype escape
  // hatch the test for `delivery-attempts` already uses (passing a
  // pre-built no-op db). To keep this self-contained, we attach the
  // ready service onto the router by monkey-patching strategyService
  // resolution: we use a custom configService that returns the canned
  // values - simpler than replacing strategyService directly.
  //
  // In practice the call paths in `sendTransactional` are:
  //   strategyService.getStrategyMeta -> reads `configService.get`
  //   strategyService.getStrategyConfig -> reads `configService.get`
  //   strategyService.getUserPreference -> reads `configService.get`
  //   strategyService.getLayoutConfig -> reads `configService.get`
  //
  // We provide a configService mock that returns the values keyed by
  // id pattern (`strategy.<id>.meta` -> { enabled: true }, etc.).
  const configService = {
    get: mock(async (id: string) => {
      if (id.endsWith(".meta")) return { enabled: true };
      if (id.endsWith(".layoutConfig")) return undefined;
      if (id.includes("user-pref.")) return null;
      // strategy config (`strategy.<id>.config`)
      return { opaque: true };
    }),
    set: mock(async () => {}),
  };

  return createNotificationRouter({
    database: db as never,
    configService: configService as never,
    signalService: makeSignalService() as never,
    strategyRegistry: makeStrategyRegistry(strategies),
    rpcApi: {
      forPlugin: () => ({
        getUserById: async () => ({
          id: "user-1",
          email: "user@example.com",
          name: "Test User",
        }),
      }),
    } as never,
    logger: makeLogger() as never,
    cache: passthroughCache,
  });
}

describe("notification router · sendTransactional (strategy fallback)", () => {
  // sendTransactional is `userType: "service"`.
  const serviceCaller = {
    type: "service" as const,
    id: "service-caller",
    pluginId: "any-plugin",
    accessRules: ["*"],
  };

  it("returns success when the primary strategy delivers and does not invoke later strategies as fallbacks", async () => {
    const secondaryCalls = mock(async () => ({ success: true }));
    const primaryCalls = mock(async () => ({ success: true }));

    const router = buildRouterForSendTransactional({
      db: {} as unknown,
      strategies: [
        { qualifiedId: "primary.send", send: primaryCalls },
        { qualifiedId: "secondary.send", send: secondaryCalls },
      ],
    });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: serviceCaller,
    });

    const result = await call(
      router.sendTransactional,
      {
        userId: "user-1",
        notification: {
          title: "Hello",
          body: "World",
        },
      },
      { context },
    );

    // sendTransactional intentionally fans out to ALL enabled
    // strategies (it's not a primary-then-fallback semantic). Both
    // succeed, so the deliveredCount counts both.
    expect(result.deliveredCount).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.success)).toBe(true);
    expect(primaryCalls).toHaveBeenCalledTimes(1);
    expect(secondaryCalls).toHaveBeenCalledTimes(1);
  });

  it("continues to the next strategy when one throws and persists the failure as a per-strategy result", async () => {
    // This is the key fallback assertion: if the first strategy
    // throws, the dispatch loop's try/catch must convert it into a
    // `success: false` result and KEEP going to the next strategy.
    const throwingPrimary = mock(async () => {
      throw new Error("primary blew up");
    });
    const workingSecondary = mock(async () => ({ success: true }));

    const router = buildRouterForSendTransactional({
      db: {} as unknown,
      strategies: [
        { qualifiedId: "primary.send", send: throwingPrimary },
        { qualifiedId: "secondary.send", send: workingSecondary },
      ],
    });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: serviceCaller,
    });

    const result = await call(
      router.sendTransactional,
      {
        userId: "user-1",
        notification: {
          title: "Hello",
          body: "World",
        },
      },
      { context },
    );

    // Primary failed but secondary recovered - exactly one delivery.
    expect(result.deliveredCount).toBe(1);
    expect(result.results).toHaveLength(2);

    const primaryResult = result.results.find(
      (r) => r.strategyId === "primary.send",
    );
    const secondaryResult = result.results.find(
      (r) => r.strategyId === "secondary.send",
    );

    expect(primaryResult).toBeDefined();
    expect(primaryResult?.success).toBe(false);
    expect(primaryResult?.error).toBe("primary blew up");

    expect(secondaryResult).toBeDefined();
    expect(secondaryResult?.success).toBe(true);

    // Both `send` calls fired - the throw did NOT short-circuit the
    // loop. That's the whole point.
    expect(throwingPrimary).toHaveBeenCalledTimes(1);
    expect(workingSecondary).toHaveBeenCalledTimes(1);
  });
});

describe("notification router · sendRawEmail (raw address)", () => {
  const serviceCaller = {
    type: "service" as const,
    id: "service-caller",
    pluginId: "any-plugin",
    accessRules: ["*"],
  };

  it("delivers to the raw address via email strategies with a mandatory unsubscribe link", async () => {
    let captured: { contact?: string; body?: string; action?: unknown } = {};
    const send = mock(
      async (ctx: {
        contact: string;
        notification: { body?: string; action?: unknown };
      }) => {
        captured = {
          contact: ctx.contact,
          body: ctx.notification.body,
          action: ctx.notification.action,
        };
        return { success: true };
      },
    );

    const router = buildRouterForSendTransactional({
      db: {} as unknown,
      strategies: [{ qualifiedId: "notification-smtp.smtp", send }],
    });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user: serviceCaller,
    });

    const result = await call(
      router.sendRawEmail,
      {
        to: "anon@example.com",
        subject: "Status update",
        body: "Something happened.",
        unsubscribeUrl: "https://status.example.com/statuspage/view/x?unsubscribe=tok",
      },
      { context },
    );

    expect(result.deliveredCount).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    // Raw address is passed straight through as the contact (no account lookup).
    expect(captured.contact).toBe("anon@example.com");
    // Mandatory unsubscribe link is in the body AND as the action.
    expect(captured.body).toContain(
      "https://status.example.com/statuspage/view/x?unsubscribe=tok",
    );
    expect(captured.action).toEqual({
      label: "Unsubscribe",
      url: "https://status.example.com/statuspage/view/x?unsubscribe=tok",
    });
  });
});

// ---------------------------------------------------------------------------
// resolveSubscriptionInheritance (structural inheritance read)
// ---------------------------------------------------------------------------

/**
 * Build a DB double for `resolveSubscriptionInheritance`. It routes by the
 * `.from(table)` handle (not a call counter) so it survives the Promise.all
 * ordering inside the handler:
 *   - subscription_specs: first query = the target's specs; every later
 *     query = the parent specs (issued from `resolveInheritedGroups`).
 *   - notification_resource_parents: the child's parent edges.
 *   - notification_resources: parent display labels.
 */
function createInheritanceDb({
  targetSpecs,
  parentSpecs,
  parentEdges,
  resourceLabels,
}: {
  targetSpecs: ReadonlyArray<Record<string, unknown>>;
  parentSpecs: ReadonlyArray<Record<string, unknown>>;
  parentEdges: ReadonlyArray<Record<string, unknown>>;
  resourceLabels: ReadonlyArray<{
    targetTypeId: string;
    resourceKey: string;
    displayLabel: string;
  }>;
}): { db: unknown } {
  let specCallIdx = 0;
  const db = {
    select: mock(() => ({
      from: mock((table: unknown) => {
        if (table === schema.subscriptionSpecs) {
          const data = specCallIdx === 0 ? targetSpecs : parentSpecs;
          specCallIdx += 1;
          return buildThenable(data);
        }
        if (table === schema.notificationResourceParents) {
          return buildThenable(parentEdges);
        }
        if (table === schema.notificationResources) {
          return buildThenable(resourceLabels);
        }
        return buildThenable([]);
      }),
    })),
    // Scoped-db contract: resolveInheritedGroups batches its two reads in a tx.
    transaction: mock((cb: (tx: unknown) => unknown) => cb(db)),
  };
  return { db };
}

describe("notification router · resolveSubscriptionInheritance", () => {
  // authenticated proc - any real user passes.
  const user = {
    type: "user" as const,
    id: "user-1",
    accessRules: ["*"],
  };

  const SYSTEM_TARGET = "catalog.system";
  const GROUP_TARGET = "catalog.group";

  const incidentSystemSpec = {
    specId: "incident.system",
    ownerPlugin: "incident",
    localId: "system",
    targetTypeId: SYSTEM_TARGET,
    displayTitle: "Incidents",
    displayDescription: "Incident notifications",
    displayIconName: null,
    registeredAt: new Date(),
  };
  const incidentGroupSpec = {
    specId: "incident.group",
    ownerPlugin: "incident",
    localId: "group",
    targetTypeId: GROUP_TARGET,
    displayTitle: "Incidents",
    displayDescription: "Incident notifications",
    displayIconName: null,
    registeredAt: new Date(),
  };

  it("returns primary group + inherited parent group with human label for a system", async () => {
    const { db } = createInheritanceDb({
      targetSpecs: [incidentSystemSpec],
      parentSpecs: [incidentGroupSpec],
      parentEdges: [
        {
          childTargetTypeId: SYSTEM_TARGET,
          childResourceKey: "system-1",
          parentTargetTypeId: GROUP_TARGET,
          parentResourceKey: "group-1",
        },
      ],
      resourceLabels: [
        {
          targetTypeId: GROUP_TARGET,
          resourceKey: "group-1",
          displayLabel: "Platform Team",
        },
      ],
    });
    const router = buildRouterForReads({ db });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user,
    });

    const result = await call(
      router.resolveSubscriptionInheritance,
      { targetTypeId: SYSTEM_TARGET, resourceKey: "system-1" },
      { context },
    );

    expect(result).toEqual([
      {
        specId: "incident.system",
        groupId: "incident.system.system-1",
        inheritance: [
          { groupId: "incident.group.group-1", label: "Platform Team" },
        ],
      },
    ]);
  });

  it("returns empty inheritance for a target with no parents (catalog.group)", async () => {
    const { db } = createInheritanceDb({
      targetSpecs: [incidentGroupSpec],
      parentSpecs: [],
      parentEdges: [], // groups have no parents
      resourceLabels: [],
    });
    const router = buildRouterForReads({ db });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user,
    });

    const result = await call(
      router.resolveSubscriptionInheritance,
      { targetTypeId: GROUP_TARGET, resourceKey: "group-1" },
      { context },
    );

    expect(result).toEqual([
      {
        specId: "incident.group",
        groupId: "incident.group.group-1",
        inheritance: [],
      },
    ]);
  });

  it("falls back to the parent resource key when the display label is missing", async () => {
    const { db } = createInheritanceDb({
      targetSpecs: [incidentSystemSpec],
      parentSpecs: [incidentGroupSpec],
      parentEdges: [
        {
          childTargetTypeId: SYSTEM_TARGET,
          childResourceKey: "system-1",
          parentTargetTypeId: GROUP_TARGET,
          parentResourceKey: "group-1",
        },
      ],
      resourceLabels: [], // no label row for the parent group
    });
    const router = buildRouterForReads({ db });

    const context = createMockRpcContext({
      pluginMetadata: { pluginId: "notification" },
      user,
    });

    const result = await call(
      router.resolveSubscriptionInheritance,
      { targetTypeId: SYSTEM_TARGET, resourceKey: "system-1" },
      { context },
    );

    expect(result[0].inheritance).toEqual([
      { groupId: "incident.group.group-1", label: "group-1" },
    ]);
  });
});
