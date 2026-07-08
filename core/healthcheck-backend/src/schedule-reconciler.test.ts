import { describe, it, expect, mock } from "bun:test";
import {
  planReconcile,
  reconcileHealthCheckJobs,
  type DesiredJob,
} from "./schedule-reconciler";
import {
  encodeHealthCheckJobId,
  type HealthCheckJobPayload,
} from "./queue-executor";

function desiredJob(props: {
  configId: string;
  systemId: string;
  environmentId: string | null;
  intervalSeconds: number;
}): DesiredJob {
  const jobId = encodeHealthCheckJobId({
    configId: props.configId,
    systemId: props.systemId,
    environmentId: props.environmentId,
  });
  return {
    jobId,
    payload: {
      configId: props.configId,
      systemId: props.systemId,
      environmentId: props.environmentId,
    },
    intervalSeconds: props.intervalSeconds,
    jitterKey: jobId,
  };
}

describe("planReconcile (pure diff)", () => {
  it("schedules desired jobs that do not exist yet", () => {
    const a = desiredJob({
      configId: "c1",
      systemId: "s1",
      environmentId: "prod",
      intervalSeconds: 30,
    });
    const plan = planReconcile({
      desired: [a],
      actualJobIds: new Set(),
      actualIntervalsById: new Map(),
      cancelOrphans: true,
    });
    expect(plan.toSchedule).toEqual([a]);
    expect(plan.toReschedule).toEqual([]);
    expect(plan.toCancel).toEqual([]);
  });

  it("leaves an unchanged existing job alone (no reschedule)", () => {
    const a = desiredJob({
      configId: "c1",
      systemId: "s1",
      environmentId: "prod",
      intervalSeconds: 30,
    });
    const plan = planReconcile({
      desired: [a],
      actualJobIds: new Set([a.jobId]),
      actualIntervalsById: new Map([[a.jobId, 30]]),
      cancelOrphans: true,
    });
    expect(plan.toSchedule).toEqual([]);
    expect(plan.toReschedule).toEqual([]);
    expect(plan.toCancel).toEqual([]);
  });

  it("reschedules an existing job only when its interval changed", () => {
    const a = desiredJob({
      configId: "c1",
      systemId: "s1",
      environmentId: "prod",
      intervalSeconds: 60,
    });
    const plan = planReconcile({
      desired: [a],
      actualJobIds: new Set([a.jobId]),
      actualIntervalsById: new Map([[a.jobId, 30]]),
      cancelOrphans: true,
    });
    expect(plan.toSchedule).toEqual([]);
    expect(plan.toReschedule).toEqual([a]);
    expect(plan.toCancel).toEqual([]);
  });

  it("cancels orphaned health-check jobs on a full reconcile", () => {
    const a = desiredJob({
      configId: "c1",
      systemId: "s1",
      environmentId: "prod",
      intervalSeconds: 30,
    });
    const orphan = encodeHealthCheckJobId({
      configId: "c9",
      systemId: "s9",
      environmentId: "staging",
    });
    const plan = planReconcile({
      desired: [a],
      actualJobIds: new Set([a.jobId, orphan]),
      actualIntervalsById: new Map([[a.jobId, 30]]),
      cancelOrphans: true,
    });
    expect(plan.toSchedule).toEqual([]);
    expect(plan.toCancel).toEqual([orphan]);
  });

  it("never cancels a non-health-check job even if it is not desired", () => {
    const a = desiredJob({
      configId: "c1",
      systemId: "s1",
      environmentId: null,
      intervalSeconds: 30,
    });
    const foreign = "some-other-plugin:job:42";
    const plan = planReconcile({
      desired: [a],
      actualJobIds: new Set([a.jobId, foreign]),
      actualIntervalsById: new Map([[a.jobId, 30]]),
      cancelOrphans: true,
    });
    expect(plan.toCancel).toEqual([]);
  });

  it("does NOT cancel orphans on a system-scoped reconcile (add/update only)", () => {
    const a = desiredJob({
      configId: "c1",
      systemId: "s1",
      environmentId: "prod",
      intervalSeconds: 30,
    });
    const orphan = encodeHealthCheckJobId({
      configId: "c9",
      systemId: "s9",
      environmentId: "staging",
    });
    const plan = planReconcile({
      desired: [a],
      actualJobIds: new Set([orphan]),
      actualIntervalsById: new Map(),
      cancelOrphans: false,
    });
    expect(plan.toSchedule).toEqual([a]);
    expect(plan.toCancel).toEqual([]);
  });
});

// ─── Integration: reconcileHealthCheckJobs against in-memory mocks ──────────

interface FakeQueue {
  scheduled: Array<{ payload: HealthCheckJobPayload; intervalSeconds: number }>;
  cancelled: string[];
  recurring: Map<string, number>;
}

function makeQueueManager(existing: Map<string, number> = new Map()) {
  const state: FakeQueue = {
    scheduled: [],
    cancelled: [],
    recurring: existing,
  };
  const queue = {
    scheduleRecurring: mock(
      async (
        payload: HealthCheckJobPayload,
        opts: { jobId: string; intervalSeconds: number },
      ) => {
        state.scheduled.push({
          payload,
          intervalSeconds: opts.intervalSeconds,
        });
        state.recurring.set(opts.jobId, opts.intervalSeconds);
        return opts.jobId;
      },
    ),
    cancelRecurring: mock(async (jobId: string) => {
      state.cancelled.push(jobId);
      state.recurring.delete(jobId);
    }),
    listRecurringJobs: mock(async () => [...state.recurring.keys()]),
    getRecurringJobDetails: mock(async (jobId: string) => {
      const intervalSeconds = state.recurring.get(jobId);
      return intervalSeconds === undefined
        ? undefined
        : { intervalSeconds };
    }),
  };
  const queueManager = {
    getQueue: () => queue,
  } as unknown as Parameters<typeof reconcileHealthCheckJobs>[0]["queueManager"];
  return { queueManager, state };
}

/**
 * Mock db whose two select() calls return, in order: (1) the enabled checks
 * join rows, (2) the last-run-per-slice rows. Mirrors the query order in
 * `reconcileHealthCheckJobs` (buildDesiredJobs first, then the lastRun query).
 */
function makeDb(props: {
  checks: Array<{
    systemId: string;
    configId: string;
    interval: number;
    environmentIds: string[] | null;
  }>;
  lastRuns?: Array<{
    systemId: string;
    configurationId: string;
    environmentId: string | null;
    maxTimestamp: Date | null;
  }>;
}) {
  let call = 0;
  const db = {
    select: mock(() => {
      call++;
      if (call === 1) {
        return {
          from: () => ({
            innerJoin: () => ({
              where: () => Promise.resolve(props.checks),
            }),
          }),
        };
      }
      return {
        from: () => ({
          groupBy: () => Promise.resolve(props.lastRuns ?? []),
        }),
      };
    }),
  };
  return db as unknown as Parameters<typeof reconcileHealthCheckJobs>[0]["db"];
}

function makeCatalogClient(
  membershipBySystem: Record<
    string,
    Array<{ id: string; name: string; metadata: Record<string, unknown> | null }>
  >,
) {
  return {
    resolveSystemEnvironments: mock(
      async ({ systemId }: { systemId: string }) =>
        (membershipBySystem[systemId] ?? []).map((m) => ({
          ...m,
          description: null,
          systemIds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
    ),
  } as unknown as Parameters<
    typeof reconcileHealthCheckJobs
  >[0]["catalogClient"];
}

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Parameters<typeof reconcileHealthCheckJobs>[0]["logger"];

describe("reconcileHealthCheckJobs (integration)", () => {
  it("schedules one job per effective environment for a full reconcile", async () => {
    const { queueManager, state } = makeQueueManager();
    const db = makeDb({
      checks: [
        {
          systemId: "s1",
          configId: "c1",
          interval: 30,
          environmentIds: null,
        },
      ],
    });
    const catalogClient = makeCatalogClient({
      s1: [
        { id: "prod", name: "Production", metadata: {} },
        { id: "staging", name: "Staging", metadata: {} },
      ],
    });

    await reconcileHealthCheckJobs({
      db,
      queueManager,
      catalogClient,
      logger: silentLogger,
      now: 1_000_000,
    });

    expect(state.scheduled).toHaveLength(2);
    const envs = state.scheduled.map((s) => s.payload.environmentId).sort();
    expect(envs).toEqual(["prod", "staging"]);
    expect(state.cancelled).toEqual([]);
  });

  it("schedules a single env-less job when the system has no environments", async () => {
    const { queueManager, state } = makeQueueManager();
    const db = makeDb({
      checks: [
        { systemId: "s1", configId: "c1", interval: 30, environmentIds: null },
      ],
    });
    const catalogClient = makeCatalogClient({ s1: [] });

    await reconcileHealthCheckJobs({
      db,
      queueManager,
      catalogClient,
      logger: silentLogger,
      now: 1_000_000,
    });

    expect(state.scheduled).toHaveLength(1);
    expect(state.scheduled[0]?.payload.environmentId).toBeNull();
  });

  it("cancels an orphaned health-check job that is no longer desired", async () => {
    const orphan = encodeHealthCheckJobId({
      configId: "old",
      systemId: "gone",
      environmentId: "prod",
    });
    const { queueManager, state } = makeQueueManager(
      new Map([[orphan, 30]]),
    );
    const db = makeDb({
      checks: [
        { systemId: "s1", configId: "c1", interval: 30, environmentIds: [] },
      ],
    });
    const catalogClient = makeCatalogClient({ s1: [] });

    await reconcileHealthCheckJobs({
      db,
      queueManager,
      catalogClient,
      logger: silentLogger,
      now: 1_000_000,
    });

    expect(state.cancelled).toEqual([orphan]);
    // The env-less desired job was scheduled.
    expect(state.scheduled).toHaveLength(1);
  });

  it("takes the health:reconcile advisory lock for a full reconcile", async () => {
    const { queueManager } = makeQueueManager();
    const db = makeDb({ checks: [] });
    const catalogClient = makeCatalogClient({});
    const withXactLock = mock(
      async ({ fn }: { key: string; fn: () => Promise<void> }) => {
        await fn();
      },
    );
    const advisoryLock = {
      withXactLock,
    } as unknown as Parameters<
      typeof reconcileHealthCheckJobs
    >[0]["advisoryLock"];

    await reconcileHealthCheckJobs({
      db,
      queueManager,
      catalogClient,
      logger: silentLogger,
      advisoryLock,
      now: 1_000_000,
    });

    expect(withXactLock).toHaveBeenCalledTimes(1);
    expect(withXactLock.mock.calls[0]![0]!.key).toBe("health:reconcile");
  });

  it("does not cancel orphans on a system-scoped reconcile", async () => {
    const orphan = encodeHealthCheckJobId({
      configId: "old",
      systemId: "gone",
      environmentId: "prod",
    });
    const { queueManager, state } = makeQueueManager(
      new Map([[orphan, 30]]),
    );
    const db = makeDb({
      checks: [
        {
          systemId: "s1",
          configId: "c1",
          interval: 30,
          environmentIds: null,
        },
      ],
    });
    const catalogClient = makeCatalogClient({
      s1: [{ id: "prod", name: "Production", metadata: {} }],
    });

    await reconcileHealthCheckJobs({
      db,
      queueManager,
      catalogClient,
      logger: silentLogger,
      systemId: "s1",
      now: 1_000_000,
    });

    // The system's prod job is scheduled; the foreign orphan is left intact.
    expect(state.scheduled).toHaveLength(1);
    expect(state.scheduled[0]?.payload.environmentId).toBe("prod");
    expect(state.cancelled).toEqual([]);
  });
});
