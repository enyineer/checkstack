/**
 * Integration test (real Redis / BullMQ) for `reconcileHealthCheckJobs`.
 *
 * The reconciler's decisions are DATA-DRIVEN by what it reads back from the
 * queue: `listRecurringJobs()` + `getRecurringJobDetails()` feed `planReconcile`,
 * which then schedules / reschedules / cancels. The unit test
 * (`schedule-reconciler.test.ts`) proves the plan against an in-memory fake, but
 * only a real backend proves the read-back semantics the plan depends on:
 * upsert-in-place (no duplicate scheduler), interval read-back driving a
 * reschedule, and prefix-scoped orphan cancellation actually removing the right
 * schedulers from Redis.
 *
 * To honour the dependency direction (healthcheck-backend must not depend on a
 * queue *implementation* plugin), this drives raw `bullmq` primitives through a
 * thin shim that mirrors the `BullMQQueue` adapter's recurring methods
 * EXACTLY - `upsertJobScheduler` / `getJobSchedulers` / `removeJobScheduler`.
 * The adapter's own conformance to that contract is pinned separately by
 * `plugins/queue-bullmq-backend/src/bullmq-queue.it.test.ts`; here we exercise
 * the RECONCILER against a backend with real persistence between calls.
 *
 * Gated behind `CHECKSTACK_IT`; the `integration` CI job sets it and provides a
 * real Redis (`CHECKSTACK_IT_REDIS_URL`). Each test uses a unique queue name +
 * key prefix and obliterates afterwards.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { Queue } from "bullmq";
import type { RecurringJobDetails } from "@checkstack/queue-api";
import { reconcileHealthCheckJobs } from "./schedule-reconciler";
import {
  HEALTH_CHECK_QUEUE,
  type HealthCheckJobPayload,
} from "./queue-executor";

type ReconcileProps = Parameters<typeof reconcileHealthCheckJobs>[0];

function redisParts(): { host: string; port: number; password?: string } {
  const url = new URL(
    process.env.CHECKSTACK_IT_REDIS_URL ?? "redis://localhost:6379",
  );
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
  };
}

const PREFIX = `it:${crypto.randomUUID().replace(/-/g, "")}`;

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as ReconcileProps["logger"];

/** Mock db: two selects - (1) enabled checks join, (2) last-run-per-slice. */
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
}): ReconcileProps["db"] {
  const from = () => ({
    innerJoin: () => ({ where: () => Promise.resolve(props.checks) }),
    groupBy: () => Promise.resolve(props.lastRuns ?? []),
  });
  return { select: () => ({ from }) } as unknown as ReconcileProps["db"];
}

function makeCatalogClient(
  membershipBySystem: Record<string, Array<{ id: string; name: string }>>,
): ReconcileProps["catalogClient"] {
  return {
    resolveSystemEnvironments: async ({ systemId }: { systemId: string }) =>
      (membershipBySystem[systemId] ?? []).map((m) => ({
        ...m,
        description: null,
        metadata: {},
        systemIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
  } as unknown as ReconcileProps["catalogClient"];
}

/**
 * A queue-api shim over raw BullMQ, using the SAME scheduler primitives as the
 * `BullMQQueue` adapter, plus per-method call counters so a test can assert the
 * reconciler did (or did NOT) schedule/cancel.
 */
function makeQueueEnv(queueName: string) {
  const raw = new Queue(queueName, { connection: redisParts(), prefix: PREFIX });
  const calls = { scheduleRecurring: 0, cancelRecurring: 0 };

  const shim = {
    async scheduleRecurring(
      data: HealthCheckJobPayload,
      opts: {
        jobId: string;
        priority?: number;
        startDelay?: number;
        intervalSeconds?: number;
        cronPattern?: string;
      },
    ): Promise<string> {
      calls.scheduleRecurring += 1;
      const isCron = Boolean(opts.cronPattern);
      await raw.upsertJobScheduler(
        opts.jobId,
        isCron
          ? { pattern: opts.cronPattern! }
          : {
              every: opts.intervalSeconds! * 1000,
              ...(opts.startDelay && opts.startDelay > 0
                ? { startDate: Date.now() + opts.startDelay * 1000 }
                : {}),
            },
        { name: queueName, data, opts: { priority: opts.priority } },
      );
      return opts.jobId;
    },
    async cancelRecurring(jobId: string): Promise<void> {
      calls.cancelRecurring += 1;
      await raw.removeJobScheduler(jobId);
    },
    async listRecurringJobs(): Promise<string[]> {
      const schedulers = await raw.getJobSchedulers();
      return schedulers.map((s) => s.key);
    },
    async getRecurringJobDetails(
      jobId: string,
    ): Promise<RecurringJobDetails<HealthCheckJobPayload> | undefined> {
      const schedulers = await raw.getJobSchedulers();
      const s = schedulers.find((x) => x.key === jobId);
      if (!s) return undefined;
      const base = {
        jobId,
        // Cross the untyped bullmq template boundary exactly as the adapter does.
        data: s.template?.data as HealthCheckJobPayload,
        priority: s.template?.opts?.priority,
        nextRunAt: s.next ? new Date(s.next) : undefined,
      };
      return s.pattern
        ? { ...base, cronPattern: s.pattern }
        : { ...base, intervalSeconds: s.every ? Number(s.every) / 1000 : 0 };
    },
  };

  const queueManager = {
    getQueue: () => shim,
  } as unknown as ReconcileProps["queueManager"];

  return { raw, calls, queueManager, shim };
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "reconcileHealthCheckJobs (real Redis)",
  () => {
    const raws: Queue[] = [];
    function env() {
      const e = makeQueueEnv(`it_reconcile_${crypto.randomUUID().replace(/-/g, "")}`);
      raws.push(e.raw);
      return e;
    }

    afterEach(async () => {
      for (const raw of raws.splice(0)) {
        await raw.obliterate({ force: true }).catch(() => {});
        await raw.close();
      }
    });

    it("schedules one recurring job per effective environment with the right payload", async () => {
      const { queueManager, shim } = env();
      await reconcileHealthCheckJobs({
        db: makeDb({
          checks: [
            { systemId: "s1", configId: "c1", interval: 30, environmentIds: null },
          ],
        }),
        catalogClient: makeCatalogClient({
          s1: [
            { id: "prod", name: "Production" },
            { id: "staging", name: "Staging" },
          ],
        }),
        queueManager,
        logger: silentLogger,
        now: 1_000_000,
      });

      expect((await shim.listRecurringJobs()).toSorted()).toEqual([
        "healthcheck:c1:s1:prod",
        "healthcheck:c1:s1:staging",
      ]);
      const prod = await shim.getRecurringJobDetails("healthcheck:c1:s1:prod");
      expect(prod?.intervalSeconds).toBe(30);
      expect(prod?.data).toEqual({
        configId: "c1",
        systemId: "s1",
        environmentId: "prod",
      });
    });

    it("schedules a single bare job for an env-less system (environmentId null)", async () => {
      const { queueManager, shim } = env();
      await reconcileHealthCheckJobs({
        db: makeDb({
          checks: [
            { systemId: "s1", configId: "c1", interval: 30, environmentIds: null },
          ],
        }),
        catalogClient: makeCatalogClient({ s1: [] }),
        queueManager,
        logger: silentLogger,
        now: 1_000_000,
      });

      expect(await shim.listRecurringJobs()).toEqual(["healthcheck:c1:s1"]);
      const details = await shim.getRecurringJobDetails("healthcheck:c1:s1");
      expect(details?.data.environmentId).toBeNull();
    });

    it("is idempotent: a second identical full reconcile schedules and cancels nothing", async () => {
      const { queueManager, shim, calls } = env();
      const args = {
        db: makeDb({
          checks: [
            { systemId: "s1", configId: "c1", interval: 30, environmentIds: null },
          ],
        }),
        catalogClient: makeCatalogClient({
          s1: [{ id: "prod", name: "Production" }],
        }),
        queueManager,
        logger: silentLogger,
        now: 1_000_000,
      };

      await reconcileHealthCheckJobs(args);
      const afterFirst = { ...calls };

      // Fresh db/catalog (same desired), same real Redis state.
      await reconcileHealthCheckJobs({
        ...args,
        db: makeDb({
          checks: [
            { systemId: "s1", configId: "c1", interval: 30, environmentIds: null },
          ],
        }),
      });

      // Interval already matches, job already present -> no work the 2nd time.
      expect(calls.scheduleRecurring).toBe(afterFirst.scheduleRecurring);
      expect(calls.cancelRecurring).toBe(afterFirst.cancelRecurring);
      expect(await shim.listRecurringJobs()).toEqual(["healthcheck:c1:s1:prod"]);
    });

    it("reschedules in place when the interval changes (no duplicate scheduler)", async () => {
      const { queueManager, shim, calls } = env();
      const catalogClient = makeCatalogClient({
        s1: [{ id: "prod", name: "Production" }],
      });

      await reconcileHealthCheckJobs({
        db: makeDb({
          checks: [
            { systemId: "s1", configId: "c1", interval: 30, environmentIds: null },
          ],
        }),
        catalogClient,
        queueManager,
        logger: silentLogger,
        now: 1_000_000,
      });
      const scheduledAfterFirst = calls.scheduleRecurring;

      await reconcileHealthCheckJobs({
        db: makeDb({
          checks: [
            { systemId: "s1", configId: "c1", interval: 60, environmentIds: null },
          ],
        }),
        catalogClient,
        queueManager,
        logger: silentLogger,
        now: 1_000_000,
      });

      // Exactly one slice, interval updated in place, no orphan cancels.
      expect(await shim.listRecurringJobs()).toEqual(["healthcheck:c1:s1:prod"]);
      const details = await shim.getRecurringJobDetails("healthcheck:c1:s1:prod");
      expect(details?.intervalSeconds).toBe(60);
      expect(calls.scheduleRecurring).toBe(scheduledAfterFirst + 1);
      expect(calls.cancelRecurring).toBe(0);
    });

    it("cancels orphaned jobs when a check disappears from the desired set", async () => {
      const { queueManager, shim } = env();
      const catalogClient = makeCatalogClient({
        s1: [{ id: "prod", name: "Production" }],
      });

      await reconcileHealthCheckJobs({
        db: makeDb({
          checks: [
            { systemId: "s1", configId: "c1", interval: 30, environmentIds: null },
          ],
        }),
        catalogClient,
        queueManager,
        logger: silentLogger,
        now: 1_000_000,
      });
      expect(await shim.listRecurringJobs()).toEqual(["healthcheck:c1:s1:prod"]);

      // Check removed (e.g. disabled/deleted) -> desired set empty -> orphan cancel.
      await reconcileHealthCheckJobs({
        db: makeDb({ checks: [] }),
        catalogClient,
        queueManager,
        logger: silentLogger,
        now: 1_000_000,
      });
      expect(await shim.listRecurringJobs()).toEqual([]);
    });

    it("a system-scoped reconcile never cancels another system's jobs", async () => {
      const { queueManager, shim, calls } = env();
      const catalogClient = makeCatalogClient({
        s1: [{ id: "prod", name: "Production" }],
        s2: [{ id: "prod", name: "Production" }],
      });

      // Full reconcile schedules both systems.
      await reconcileHealthCheckJobs({
        db: makeDb({
          checks: [
            { systemId: "s1", configId: "c1", interval: 30, environmentIds: null },
            { systemId: "s2", configId: "c2", interval: 30, environmentIds: null },
          ],
        }),
        catalogClient,
        queueManager,
        logger: silentLogger,
        now: 1_000_000,
      });
      const cancelsAfterFull = calls.cancelRecurring;

      // Scoped reconcile for s1 only (buildDesiredJobs filters to s1); it must
      // NOT sweep s2's job even though s2 is absent from this scoped desired set.
      await reconcileHealthCheckJobs({
        db: makeDb({
          checks: [
            { systemId: "s1", configId: "c1", interval: 30, environmentIds: null },
          ],
        }),
        catalogClient,
        queueManager,
        logger: silentLogger,
        systemId: "s1",
        now: 1_000_000,
      });

      expect((await shim.listRecurringJobs()).toSorted()).toEqual([
        "healthcheck:c1:s1:prod",
        "healthcheck:c2:s2:prod",
      ]);
      expect(calls.cancelRecurring).toBe(cancelsAfterFull);
    });

    it("leaves a foreign (non-healthcheck) recurring job untouched on a full reconcile", async () => {
      const { queueManager, shim, raw } = env();
      // A recurring job owned by some other plugin, not the healthcheck prefix.
      await raw.upsertJobScheduler(
        "otherplugin:job1",
        { every: 60_000 },
        { name: "other", data: {} },
      );

      await reconcileHealthCheckJobs({
        db: makeDb({
          checks: [
            { systemId: "s1", configId: "c1", interval: 30, environmentIds: null },
          ],
        }),
        catalogClient: makeCatalogClient({
          s1: [{ id: "prod", name: "Production" }],
        }),
        queueManager,
        logger: silentLogger,
        now: 1_000_000,
      });

      // The orphan filter is prefix-scoped, so the foreign scheduler survives.
      expect((await shim.listRecurringJobs()).toSorted()).toEqual([
        "healthcheck:c1:s1:prod",
        "otherplugin:job1",
      ]);
    });

    it("cancels the bare env-less job and fans out when a system gains environments", async () => {
      const { queueManager, shim } = env();
      const db = makeDb({
        checks: [
          { systemId: "s1", configId: "c1", interval: 30, environmentIds: null },
        ],
      });

      // First: no environments -> a single bare job.
      await reconcileHealthCheckJobs({
        db,
        catalogClient: makeCatalogClient({ s1: [] }),
        queueManager,
        logger: silentLogger,
        now: 1_000_000,
      });
      expect(await shim.listRecurringJobs()).toEqual(["healthcheck:c1:s1"]);

      // Then: the system joins two environments -> the bare job is now an
      // orphan and must be cancelled, replaced by one job per environment.
      await reconcileHealthCheckJobs({
        db: makeDb({
          checks: [
            { systemId: "s1", configId: "c1", interval: 30, environmentIds: null },
          ],
        }),
        catalogClient: makeCatalogClient({
          s1: [
            { id: "prod", name: "Production" },
            { id: "staging", name: "Staging" },
          ],
        }),
        queueManager,
        logger: silentLogger,
        now: 1_000_000,
      });

      expect((await shim.listRecurringJobs()).toSorted()).toEqual([
        "healthcheck:c1:s1:prod",
        "healthcheck:c1:s1:staging",
      ]);
    });
  },
);
