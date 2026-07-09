import { describe, it, expect, mock } from "bun:test";
import {
  setupRollupConsumer,
  encodeRollupDebounceJobId,
  HEALTH_ROLLUP_QUEUE,
  type HealthRollupJobPayload,
} from "./rollup-consumer";
import { encodeHealthEntityId } from "./health-entity-id";
import type { EntityChanged, OnEntityChanged } from "@checkstack/automation-backend";

describe("encodeRollupDebounceJobId", () => {
  it("coalesces changes in the same window to one jobId", () => {
    const a = encodeRollupDebounceJobId({ systemId: "s1", now: 10_000, windowMs: 2000 });
    const b = encodeRollupDebounceJobId({ systemId: "s1", now: 11_500, windowMs: 2000 });
    expect(a).toBe(b);
    expect(a).toBe("healthrollup:s1:5");
  });

  it("uses a fresh jobId for the next window", () => {
    const a = encodeRollupDebounceJobId({ systemId: "s1", now: 10_000, windowMs: 2000 });
    const b = encodeRollupDebounceJobId({ systemId: "s1", now: 12_500, windowMs: 2000 });
    expect(a).not.toBe(b);
  });

  it("keys distinct systems separately", () => {
    const a = encodeRollupDebounceJobId({ systemId: "s1", now: 10_000, windowMs: 2000 });
    const b = encodeRollupDebounceJobId({ systemId: "s2", now: 10_000, windowMs: 2000 });
    expect(a).not.toBe(b);
  });
});

interface Harness {
  enqueue: ReturnType<typeof mock>;
  consumeHandler: (job: { data: HealthRollupJobPayload }) => Promise<void>;
  changeHandler: (change: EntityChanged) => Promise<void>;
  getSystemHealthStatus: ReturnType<typeof mock>;
  broadcast: ReturnType<typeof mock>;
  reconcile: ReturnType<typeof mock>;
}

async function setup(opts: {
  statuses?: string[]; // successive getSystemHealthStatus results
  now?: number;
} = {}): Promise<Harness> {
  const statuses = opts.statuses ?? ["healthy", "healthy"];
  let statusCall = 0;
  const getSystemHealthStatus = mock(async () => ({
    status: statuses[Math.min(statusCall++, statuses.length - 1)],
    checkStatuses: [],
  }));

  const enqueue = mock(async () => "job-id");
  let consumeHandler!: (job: { data: HealthRollupJobPayload }) => Promise<void>;
  const queue = {
    enqueue,
    consume: mock(
      async (
        handler: (job: { data: HealthRollupJobPayload }) => Promise<void>,
      ) => {
        consumeHandler = handler;
      },
    ),
  };
  const queueManager = {
    getQueue: mock((name: string) => {
      expect(name).toBe(HEALTH_ROLLUP_QUEUE);
      return queue;
    }),
  } as unknown as Parameters<typeof setupRollupConsumer>[0]["queueManager"];

  let changeHandler!: (change: EntityChanged) => Promise<void>;
  const onEntityChanged = mock((input: Parameters<OnEntityChanged>[0]) => {
    changeHandler = input.handler as (c: EntityChanged) => Promise<void>;
    return async () => {};
  }) as unknown as OnEntityChanged;

  const broadcast = mock(async () => {});
  const reconcile = mock(async () => {});

  await setupRollupConsumer({
    queueManager,
    onEntityChanged,
    service: { getSystemHealthStatus } as never,
    advisoryLock: {
      withXactLock: async ({ fn }: { fn: () => Promise<unknown> }) => fn(),
    } as never,
    signalService: { broadcast } as never,
    cache: { reconcile } as never,
    // No entity handle: writeHealthEntity runs `apply` directly.
    getHealthEntity: () => undefined,
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as never,
    now: () => opts.now ?? 10_000,
  });

  return {
    enqueue,
    consumeHandler,
    changeHandler,
    getSystemHealthStatus,
    broadcast,
    reconcile,
  };
}

describe("setupRollupConsumer subscription", () => {
  it("enqueues a debounced rollup job for a per-env health change", async () => {
    const h = await setup({ now: 10_000 });
    await h.changeHandler({
      kind: "health",
      id: encodeHealthEntityId({ systemId: "s1", environmentId: "prod" }),
      prev: null,
      next: { status: "unhealthy" },
    } as unknown as EntityChanged);

    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(h.enqueue.mock.calls[0]![0]).toEqual({ systemId: "s1" });
    expect(h.enqueue.mock.calls[0]![1]).toMatchObject({
      jobId: "healthrollup:s1:5",
      startDelay: 2,
    });
  });

  it("IGNORES a bare-rollup change (feedback-loop guard)", async () => {
    const h = await setup();
    await h.changeHandler({
      kind: "health",
      id: encodeHealthEntityId({ systemId: "s1" }), // bare rollup id
      prev: null,
      next: { status: "unhealthy" },
    } as unknown as EntityChanged);

    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("coalesces two per-env changes in the same window to one jobId", async () => {
    const h = await setup({ now: 10_000 });
    const mk = (env: string) =>
      ({
        kind: "health",
        id: encodeHealthEntityId({ systemId: "s1", environmentId: env }),
        prev: null,
        next: { status: "unhealthy" },
      }) as unknown as EntityChanged;

    await h.changeHandler(mk("prod"));
    await h.changeHandler(mk("staging"));

    // Both enqueue with the SAME jobId; the queue backend dedupes them.
    expect(h.enqueue).toHaveBeenCalledTimes(2);
    expect(h.enqueue.mock.calls[0]![1]).toMatchObject({
      jobId: "healthrollup:s1:5",
    });
    expect(h.enqueue.mock.calls[1]![1]).toMatchObject({
      jobId: "healthrollup:s1:5",
    });
  });
});

describe("setupRollupConsumer rollup recompute", () => {
  it("reconciles the cache + broadcasts SYSTEM_STATUS_CHANGED on a rollup status change", async () => {
    const h = await setup({ statuses: ["healthy", "unhealthy"] });
    await h.consumeHandler({ data: { systemId: "s1" } });

    expect(h.getSystemHealthStatus).toHaveBeenCalled();
    // Reconcile is handed the FULL prev/next states; the change-gating (evict +
    // cluster broadcast only on a per-check vector change) lives inside the cache
    // (see cache.test.ts), so recompute always calls it with both states.
    expect(h.reconcile).toHaveBeenCalledTimes(1);
    expect(h.reconcile.mock.calls[0]![0]).toMatchObject({
      systemId: "s1",
      previous: { status: "healthy" },
      next: { status: "unhealthy" },
    });
    // The frontend signal IS gated here on the rollup-enum transition.
    expect(h.broadcast).toHaveBeenCalledTimes(1);
    const payload = h.broadcast.mock.calls[0]![1] as {
      systemId: string;
      previousStatus: string;
      newStatus: string;
    };
    expect(payload).toEqual({
      systemId: "s1",
      previousStatus: "healthy",
      newStatus: "unhealthy",
    });
  });

  it("does NOT broadcast the frontend signal when the rollup status is unchanged", async () => {
    const h = await setup({ statuses: ["degraded", "degraded"] });
    await h.consumeHandler({ data: { systemId: "s1" } });

    // No enum transition ⇒ no SYSTEM_STATUS_CHANGED frontend signal. Reconcile is
    // still invoked (its own fingerprint gate no-ops for an unchanged vector).
    expect(h.broadcast).not.toHaveBeenCalled();
    expect(h.reconcile).toHaveBeenCalledTimes(1);
  });
});
