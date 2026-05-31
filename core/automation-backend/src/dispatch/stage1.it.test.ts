/**
 * Integration test (real Redis / BullMQ) for Stage-1 routing exactly-once.
 *
 * Part of the surgical integration lane (plan §14.4 #4). The Stage-1 router
 * subscribes to `ENTITY_CHANGED` in work-queue mode
 * (`workerGroup: "automation-entity-route"`); the event-bus realises that as
 * a BullMQ consumer group, so exactly one of N competing workers claims a
 * given message. This pins that third-party contract directly against
 * BullMQ: two workers sharing one consumer group on one queue → a single
 * enqueued job is processed EXACTLY ONCE.
 *
 * Gated behind `CHECKSTACK_IT=1` so the default `bun test` never runs it. The
 * `integration` CI job sets the flag and provides a real Redis service.
 * Connection comes from `CHECKSTACK_IT_REDIS_URL` (defaulting to the
 * `docker-compose-dev.yml` Redis port). Each run uses a unique queue name +
 * key prefix and tears the queue down afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Queue, Worker, type ConnectionOptions } from "bullmq";

function redisConnection(): ConnectionOptions {
  const url = new URL(
    process.env.CHECKSTACK_IT_REDIS_URL ?? "redis://localhost:6379",
  );
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
  };
}

const QUEUE = `it_stage1_${crypto.randomUUID().replace(/-/g, "")}`;
const PREFIX = `it:${crypto.randomUUID().replace(/-/g, "")}`;

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "Stage-1 routing exactly-once (real Redis)",
  () => {
    let queue: Queue;
    const workers: Worker[] = [];

    beforeAll(() => {
      queue = new Queue(QUEUE, {
        connection: redisConnection(),
        prefix: PREFIX,
      });
    });

    afterAll(async () => {
      for (const w of workers) await w.close();
      await queue.obliterate({ force: true }).catch(() => {});
      await queue.close();
    });

    it("one ENTITY_CHANGED-style job runs the routing handler exactly once across two workers", async () => {
      let processed = 0;
      const seen: string[] = [];

      // Two competing workers in the SAME consumer group (the event-bus uses
      // the worker-group name as the BullMQ group; two workers on the same
      // queue compete, so only one claims a given job).
      const makeWorker = () =>
        new Worker(
          QUEUE,
          async (job) => {
            processed += 1;
            seen.push(String(job.data.ref));
          },
          { connection: redisConnection(), prefix: PREFIX },
        );
      workers.push(makeWorker(), makeWorker());

      // Wait for both workers to be ready before enqueuing.
      await Promise.all(workers.map((w) => w.waitUntilReady()));

      await queue.add("entity-changed", { ref: "health:sys-1" });

      // Give the workers time to claim + process.
      await new Promise((r) => setTimeout(r, 1500));

      expect(processed).toBe(1);
      expect(seen).toEqual(["health:sys-1"]);
    });
  },
);
