/**
 * Integration test (real Redis / BullMQ) for the recurring-job interface of the
 * `BullMQQueue` adapter.
 *
 * The scheduling reconciler (and any other caller) drives recurring jobs purely
 * through this contract: `scheduleRecurring` (create-or-UPDATE by jobId),
 * `listRecurringJobs`, `getRecurringJobDetails`, `cancelRecurring`. The unit
 * tests mock the `bullmq` module, so they can only assert we CALL
 * `upsertJobScheduler`; they cannot prove BullMQ actually REPLACES a
 * scheduler's template (data + interval) when the same jobId is re-scheduled.
 * That upsert-data subtlety has bitten us before - a re-schedule that silently
 * kept the stale payload - so this pins it against a real Redis:
 *
 *  - re-scheduling the SAME jobId updates data AND interval in place, with NO
 *    duplicate scheduler, and
 *  - a job the scheduler actually PRODUCES carries the updated data, not the
 *    original.
 *
 * Gated behind `CHECKSTACK_IT`, so the default `bun test` never runs it. The
 * `integration` CI job sets the flag and provides a real Redis service; the URL
 * comes from `CHECKSTACK_IT_REDIS_URL` (defaulting to the `docker-compose-dev`
 * Redis port). Each run uses a unique queue name + key prefix and obliterates
 * the queue afterwards.
 */
import { afterAll, beforeEach, afterEach, describe, expect, it } from "bun:test";
import { Queue, Worker } from "bullmq";
import { BullMQQueue } from "./bullmq-queue";

interface Payload {
  configId: string;
  systemId: string;
  environmentId: string | null;
  marker: string;
}

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

/** Poll `fn` until it returns a truthy value or `timeoutMs` elapses. */
async function waitFor<T>(
  fn: () => Promise<T | undefined> | T | undefined,
  { timeoutMs = 5000, stepMs = 50 }: { timeoutMs?: number; stepMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= deadline) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "BullMQQueue recurring interface (real Redis)",
  () => {
    // A fresh queue name per test keeps schedulers isolated; the shared PREFIX
    // is obliterated once at the end.
    let queueName: string;
    let queue: BullMQQueue<Payload>;
    const workers: Worker[] = [];

    beforeEach(() => {
      queueName = `it_recurring_${crypto.randomUUID().replace(/-/g, "")}`;
      queue = new BullMQQueue<Payload>(queueName, {
        ...redisParts(),
        db: 0,
        keyPrefix: PREFIX,
        concurrency: 5,
      });
    });

    afterEach(async () => {
      for (const w of workers.splice(0)) await w.close();
      await queue.stop();
    });

    afterAll(async () => {
      // One handle over the shared prefix to wipe every test's keyspace.
      const sweeper = new Queue(`it_recurring_sweep`, {
        connection: redisParts(),
        prefix: PREFIX,
      });
      await sweeper.obliterate({ force: true }).catch(() => {});
      await sweeper.close();
    });

    it("schedules, lists, reads back, and cancels a recurring job", async () => {
      const jobId = "healthcheck:c1:s1:prod";
      const payload: Payload = {
        configId: "c1",
        systemId: "s1",
        environmentId: "prod",
        marker: "v1",
      };

      await queue.scheduleRecurring(payload, { jobId, intervalSeconds: 30 });

      expect(await queue.listRecurringJobs()).toEqual([jobId]);

      const details = await queue.getRecurringJobDetails(jobId);
      expect(details?.jobId).toBe(jobId);
      expect(details?.intervalSeconds).toBe(30);
      expect(details?.data).toEqual(payload);

      await queue.cancelRecurring(jobId);

      expect(await queue.listRecurringJobs()).toEqual([]);
      expect(await queue.getRecurringJobDetails(jobId)).toBeUndefined();
    });

    it("re-scheduling the same jobId UPSERTS data + interval in place (no duplicate)", async () => {
      const jobId = "healthcheck:c1:s1:prod";
      const first: Payload = {
        configId: "c1",
        systemId: "s1",
        environmentId: "prod",
        marker: "before",
      };
      const second: Payload = { ...first, marker: "after" };

      await queue.scheduleRecurring(first, { jobId, intervalSeconds: 30 });
      // Same jobId, different data AND different interval.
      await queue.scheduleRecurring(second, { jobId, intervalSeconds: 60 });

      // Still exactly ONE scheduler - upsert, not append.
      expect(await queue.listRecurringJobs()).toEqual([jobId]);

      // The template reflects the SECOND schedule, not the stale first one.
      const details = await queue.getRecurringJobDetails(jobId);
      expect(details?.intervalSeconds).toBe(60);
      expect(details?.data).toEqual(second);
      expect(details?.data.marker).toBe("after");
    });

    it("a job the scheduler PRODUCES carries the upserted data, not the original", async () => {
      const jobId = "healthcheck:c1:s1:prod";
      const first: Payload = {
        configId: "c1",
        systemId: "s1",
        environmentId: "prod",
        marker: "original",
      };
      const updated: Payload = { ...first, marker: "upserted" };

      // Record every payload the scheduler actually delivers.
      const delivered: string[] = [];
      const worker = new Worker<Payload>(
        queueName,
        async (job) => {
          delivered.push(job.data.marker);
        },
        { connection: redisParts(), prefix: PREFIX },
      );
      workers.push(worker);
      await worker.waitUntilReady();

      // Short interval so jobs are produced within the test window.
      await queue.scheduleRecurring(first, { jobId, intervalSeconds: 1 });
      await waitFor(() => delivered.includes("original") || undefined);

      // Upsert the data; subsequent produced jobs must carry the new payload.
      await queue.scheduleRecurring(updated, { jobId, intervalSeconds: 1 });
      await waitFor(() => delivered.includes("upserted") || undefined, {
        timeoutMs: 8000,
      });

      // After the upsert we must NOT keep seeing the stale payload.
      const upsertedAt = delivered.indexOf("upserted");
      expect(upsertedAt).toBeGreaterThanOrEqual(0);
      expect(delivered.slice(upsertedAt)).not.toContain("original");
    });

    it("lists and cancels the correct job among several schedulers", async () => {
      const ids = [
        "healthcheck:c1:s1:prod",
        "healthcheck:c1:s1:staging",
        "healthcheck:c2:s2:prod",
      ];
      for (const jobId of ids) {
        await queue.scheduleRecurring(
          {
            configId: jobId.split(":")[1]!,
            systemId: jobId.split(":")[2]!,
            environmentId: jobId.split(":")[3]!,
            marker: "v1",
          },
          { jobId, intervalSeconds: 30 },
        );
      }

      const listedBefore = await queue.listRecurringJobs();
      expect(listedBefore.toSorted()).toEqual(ids.toSorted());

      await queue.cancelRecurring(ids[1]!);

      const listedAfter = await queue.listRecurringJobs();
      expect(listedAfter.toSorted()).toEqual([ids[0]!, ids[2]!].toSorted());
      expect(await queue.getRecurringJobDetails(ids[1]!)).toBeUndefined();
    });

    // ─── Edge cases / subtle behaviours ──────────────────────────────────────

    it("cancelRecurring on an unknown jobId is a no-op (idempotent orphan cancel)", async () => {
      // Two pods can both decide a job is orphaned and both call cancel; the
      // second cancel of an already-removed scheduler must NOT throw. The
      // reconciler relies on this - orphan cleanup is not serialized per-job.
      await queue.scheduleRecurring(
        {
          configId: "c1",
          systemId: "s1",
          environmentId: "prod",
          marker: "v1",
        },
        { jobId: "healthcheck:c1:s1:prod", intervalSeconds: 30 },
      );

      // Never-existed jobId.
      await queue.cancelRecurring("healthcheck:does:not:exist");
      // Cancel twice - the second is a no-op.
      await queue.cancelRecurring("healthcheck:c1:s1:prod");
      await queue.cancelRecurring("healthcheck:c1:s1:prod");

      expect(await queue.listRecurringJobs()).toEqual([]);
    });

    it("round-trips a null environmentId and priority through the scheduler template", async () => {
      // Env-less slices schedule with `environmentId: null`; the payload is
      // JSON-serialised into the scheduler template, and `null` must survive
      // (not become undefined / dropped) or the executor loses env context.
      const jobId = "healthcheck:c1:s1";
      const payload: Payload = {
        configId: "c1",
        systemId: "s1",
        environmentId: null,
        marker: "envless",
      };

      await queue.scheduleRecurring(payload, {
        jobId,
        intervalSeconds: 30,
        priority: 7,
      });

      const details = await queue.getRecurringJobDetails(jobId);
      expect(details?.data).toEqual(payload);
      expect(details?.data.environmentId).toBeNull();
      expect(details?.priority).toBe(7);

      // Upsert a new priority; it must be reflected, not stuck at the old value.
      await queue.scheduleRecurring(payload, {
        jobId,
        intervalSeconds: 30,
        priority: 3,
      });
      expect((await queue.getRecurringJobDetails(jobId))?.priority).toBe(3);
    });

    it("supports a cron schedule and reports cronPattern, not intervalSeconds", async () => {
      const jobId = "healthcheck:c1:s1:prod";
      await queue.scheduleRecurring(
        {
          configId: "c1",
          systemId: "s1",
          environmentId: "prod",
          marker: "cron",
        },
        { jobId, cronPattern: "*/5 * * * *" },
      );

      const details = await queue.getRecurringJobDetails(jobId);
      expect(details?.cronPattern).toBe("*/5 * * * *");
      expect(details?.intervalSeconds).toBeUndefined();
      expect(await queue.listRecurringJobs()).toEqual([jobId]);
    });

    it("switches a job from interval to cron on the same jobId (upsert replaces schedule type)", async () => {
      const jobId = "healthcheck:c1:s1:prod";
      const payload: Payload = {
        configId: "c1",
        systemId: "s1",
        environmentId: "prod",
        marker: "v1",
      };

      await queue.scheduleRecurring(payload, { jobId, intervalSeconds: 30 });
      let details = await queue.getRecurringJobDetails(jobId);
      expect(details?.intervalSeconds).toBe(30);
      expect(details?.cronPattern).toBeUndefined();

      // Same jobId, now a cron schedule - the interval schedule must be gone.
      await queue.scheduleRecurring(payload, { jobId, cronPattern: "0 * * * *" });

      expect(await queue.listRecurringJobs()).toEqual([jobId]);
      details = await queue.getRecurringJobDetails(jobId);
      expect(details?.cronPattern).toBe("0 * * * *");
      expect(details?.intervalSeconds).toBeUndefined();
    });

    it("re-scheduling identical data + interval keeps a single scheduler", async () => {
      const jobId = "healthcheck:c1:s1:prod";
      const payload: Payload = {
        configId: "c1",
        systemId: "s1",
        environmentId: "prod",
        marker: "same",
      };

      await queue.scheduleRecurring(payload, { jobId, intervalSeconds: 30 });
      await queue.scheduleRecurring(payload, { jobId, intervalSeconds: 30 });
      await queue.scheduleRecurring(payload, { jobId, intervalSeconds: 30 });

      expect(await queue.listRecurringJobs()).toEqual([jobId]);
      const details = await queue.getRecurringJobDetails(jobId);
      expect(details?.intervalSeconds).toBe(30);
      expect(details?.data).toEqual(payload);
    });
  },
);
