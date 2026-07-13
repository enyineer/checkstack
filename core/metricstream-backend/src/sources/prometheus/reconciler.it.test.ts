/**
 * Scrape scheduler convergence (integration): the reconciler derives its desired
 * recurring-job set entirely from Postgres, so these tests drive the REAL
 * `reconcileScrapeTarget` / `removeScrapeTarget` / `reconcileAll` against real
 * `metric_scrape_targets` rows, with a FAKE queue that records schedule/cancel
 * calls. The scheduling methods touch only the db + the queue, so the recorder /
 * source-registry / sink / secret deps are inert stubs here.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  withTestDb,
  isIntegrationEnabled,
  createMockLogger,
  type TestDb,
} from "@checkstack/test-utils-backend";
import type { QueueManager, Queue } from "@checkstack/queue-api";
import type {
  InternalSecretsService,
  SecretResolverService,
} from "@checkstack/secrets-backend";
import { DEFAULT_METRIC_STREAM_CONFIG } from "@checkstack/metricstream-common";
import * as schema from "../../schema";
import type { ImportantEventRecorder } from "../../events/recorder";
import type {
  MetricIngestSink,
  MetricSourceRegistry,
} from "../extension-point";
import {
  createScrapeScheduler,
  scrapeJobId,
  SCRAPE_JOB_PREFIX,
  type ScrapeJobPayload,
} from "./reconciler";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "..", "drizzle");
const STREAM = "reconciler-it-stream";
const CREATED = new Date("2026-01-01T00:00:00.000Z");

/** A fake recurring-job queue that records schedule/cancel calls. */
function fakeQueue() {
  const recurring = new Map<string, number>(); // jobId -> intervalSeconds
  const calls = { scheduled: [] as string[], cancelled: [] as string[] };
  const queue = {
    scheduleRecurring: async (
      _data: ScrapeJobPayload,
      opts: { jobId: string; intervalSeconds?: number },
    ) => {
      recurring.set(opts.jobId, opts.intervalSeconds ?? 0);
      calls.scheduled.push(opts.jobId);
      return opts.jobId;
    },
    cancelRecurring: async (jobId: string) => {
      recurring.delete(jobId);
      calls.cancelled.push(jobId);
    },
    listRecurringJobs: async () => [...recurring.keys()],
    consume: async () => {},
  } as unknown as Queue<ScrapeJobPayload>;
  const queueManager = {
    getQueue: () => queue,
  } as unknown as QueueManager;
  return { queueManager, recurring, calls };
}

const inertRecorder = { record: async () => {} } as unknown as ImportantEventRecorder;
const inertRegistry = {
  get: () => undefined,
  list: () => [],
  register: () => {},
} as unknown as MetricSourceRegistry;
const inertSink = { ingest: () => ({ accepted: 0, rejected: 0 }) } as MetricIngestSink;
const inertInternalSecrets = {
  get: async () => undefined,
  set: async () => {},
  delete: async () => {},
} as unknown as InternalSecretsService;
const inertSecretResolver = {
  resolveForRun: async () => ({ env: {} }),
} as unknown as SecretResolverService;

describe.skipIf(!isIntegrationEnabled())(
  "metricstream scrape scheduler (integration)",
  () => {
    let test: TestDb<typeof schema>;

    beforeAll(async () => {
      test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
    });
    afterAll(async () => {
      await test.dispose();
    });

    beforeEach(async () => {
      const { db } = test;
      await db.delete(schema.metricScrapeTargets);
      await db.delete(schema.metricStreams);
      await db.insert(schema.metricStreams).values({
        id: STREAM,
        name: "Reconciler IT",
        config: DEFAULT_METRIC_STREAM_CONFIG,
        createdAt: CREATED,
        updatedAt: CREATED,
      });
    });

    async function insertTarget(input: {
      id: string;
      intervalSeconds: number;
      enabled: boolean;
      satelliteId?: string | null;
    }): Promise<void> {
      await test.db.insert(schema.metricScrapeTargets).values({
        id: input.id,
        streamId: STREAM,
        name: input.id,
        url: "https://example.com/metrics",
        intervalSeconds: input.intervalSeconds,
        timeoutMs: 10_000,
        satelliteId: input.satelliteId ?? null,
        enabled: input.enabled,
      });
    }

    function buildScheduler(queueManager: QueueManager) {
      return createScrapeScheduler({
        queueManager,
        db: test.db,
        recorder: inertRecorder,
        sourceRegistry: inertRegistry,
        sink: inertSink,
        internalSecrets: inertInternalSecrets,
        secretResolver: inertSecretResolver,
        logger: createMockLogger(),
      });
    }

    it("schedules a recurring job on create", async () => {
      const { queueManager, recurring } = fakeQueue();
      const scheduler = buildScheduler(queueManager);
      await insertTarget({ id: "t1", intervalSeconds: 30, enabled: true });

      await scheduler.reconcileScrapeTarget({ targetId: "t1" });

      expect([...recurring.keys()]).toEqual([
        scrapeJobId({ targetId: "t1", intervalSeconds: 30 }),
      ]);
    });

    it("reschedules and cancels the stale jobId when the interval changes", async () => {
      const { queueManager, recurring, calls } = fakeQueue();
      const scheduler = buildScheduler(queueManager);
      await insertTarget({ id: "t1", intervalSeconds: 30, enabled: true });
      await scheduler.reconcileScrapeTarget({ targetId: "t1" });

      // Change interval -> new jobId; the old one must be cancelled.
      await test.db
        .update(schema.metricScrapeTargets)
        .set({ intervalSeconds: 60 })
        .where(eq(schema.metricScrapeTargets.id, "t1"));
      await scheduler.reconcileScrapeTarget({ targetId: "t1" });

      expect([...recurring.keys()]).toEqual([
        scrapeJobId({ targetId: "t1", intervalSeconds: 60 }),
      ]);
      expect(calls.cancelled).toContain(
        scrapeJobId({ targetId: "t1", intervalSeconds: 30 }),
      );
    });

    it("cancels a disabled target's job on reconcile", async () => {
      const { queueManager, recurring } = fakeQueue();
      const scheduler = buildScheduler(queueManager);
      await insertTarget({ id: "t1", intervalSeconds: 30, enabled: true });
      await scheduler.reconcileScrapeTarget({ targetId: "t1" });

      await test.db
        .update(schema.metricScrapeTargets)
        .set({ enabled: false })
        .where(eq(schema.metricScrapeTargets.id, "t1"));
      await scheduler.reconcileScrapeTarget({ targetId: "t1" });

      expect([...recurring.keys()]).toEqual([]);
    });

    it("cancels every job for a removed target", async () => {
      const { queueManager, recurring } = fakeQueue();
      const scheduler = buildScheduler(queueManager);
      await insertTarget({ id: "t1", intervalSeconds: 30, enabled: true });
      await scheduler.reconcileScrapeTarget({ targetId: "t1" });

      await scheduler.removeScrapeTarget({ targetId: "t1" });

      expect([...recurring.keys()]).toEqual([]);
    });

    it("reconcileAll schedules enabled targets and cancels orphans", async () => {
      const { queueManager, recurring, calls } = fakeQueue();
      const scheduler = buildScheduler(queueManager);

      // Pre-seed the queue with an orphan (a target that no longer exists) and a
      // stale-interval job for a target whose interval is now different.
      recurring.set(scrapeJobId({ targetId: "gone", intervalSeconds: 30 }), 30);
      recurring.set(scrapeJobId({ targetId: "t1", intervalSeconds: 15 }), 15);

      await insertTarget({ id: "t1", intervalSeconds: 30, enabled: true });
      await insertTarget({ id: "t2", intervalSeconds: 60, enabled: false });

      await scheduler.reconcileAll();

      const jobs = [...recurring.keys()].toSorted();
      // Only the enabled target at its current interval survives.
      expect(jobs).toEqual([scrapeJobId({ targetId: "t1", intervalSeconds: 30 })]);
      expect(calls.cancelled).toContain(
        scrapeJobId({ targetId: "gone", intervalSeconds: 30 }),
      );
      expect(calls.cancelled).toContain(
        scrapeJobId({ targetId: "t1", intervalSeconds: 15 }),
      );
      // t2 is disabled -> never scheduled.
      expect(jobs.some((j) => j.startsWith(`${SCRAPE_JOB_PREFIX}t2:`))).toBe(false);
    });

    it("never schedules a satellite-bound target on the core queue", async () => {
      const { queueManager, recurring } = fakeQueue();
      const scheduler = buildScheduler(queueManager);
      await insertTarget({
        id: "sat-1",
        intervalSeconds: 30,
        enabled: true,
        satelliteId: "satellite-a",
      });

      await scheduler.reconcileScrapeTarget({ targetId: "sat-1" });

      // Bound to a satellite -> scraped there, not on the core queue.
      expect([...recurring.keys()]).toEqual([]);
    });

    it("reconcileAll excludes satellite-bound targets from core scheduling", async () => {
      const { queueManager, recurring } = fakeQueue();
      const scheduler = buildScheduler(queueManager);
      await insertTarget({ id: "core-1", intervalSeconds: 30, enabled: true });
      await insertTarget({
        id: "sat-1",
        intervalSeconds: 30,
        enabled: true,
        satelliteId: "satellite-a",
      });

      await scheduler.reconcileAll();

      // Only the core target is scheduled; the satellite-bound one is skipped.
      expect([...recurring.keys()]).toEqual([
        scrapeJobId({ targetId: "core-1", intervalSeconds: 30 }),
      ]);
    });

    it("cancels the core job when a target rebinds core -> satellite, and reschedules on satellite -> core", async () => {
      const { queueManager, recurring, calls } = fakeQueue();
      const scheduler = buildScheduler(queueManager);
      await insertTarget({ id: "t1", intervalSeconds: 30, enabled: true });
      await scheduler.reconcileScrapeTarget({ targetId: "t1" });
      expect([...recurring.keys()]).toEqual([
        scrapeJobId({ targetId: "t1", intervalSeconds: 30 }),
      ]);

      // Rebind core -> satellite: the core job must be cancelled.
      await test.db
        .update(schema.metricScrapeTargets)
        .set({ satelliteId: "satellite-a" })
        .where(eq(schema.metricScrapeTargets.id, "t1"));
      await scheduler.reconcileScrapeTarget({ targetId: "t1" });
      expect([...recurring.keys()]).toEqual([]);
      expect(calls.cancelled).toContain(
        scrapeJobId({ targetId: "t1", intervalSeconds: 30 }),
      );

      // Rebind satellite -> core: the core job comes back.
      await test.db
        .update(schema.metricScrapeTargets)
        .set({ satelliteId: null })
        .where(eq(schema.metricScrapeTargets.id, "t1"));
      await scheduler.reconcileScrapeTarget({ targetId: "t1" });
      expect([...recurring.keys()]).toEqual([
        scrapeJobId({ targetId: "t1", intervalSeconds: 30 }),
      ]);
    });
  },
);
