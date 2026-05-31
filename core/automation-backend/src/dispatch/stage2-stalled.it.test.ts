/**
 * Integration test (real Redis / BullMQ) for Stage-2 stalled redelivery.
 *
 * Part of the surgical integration lane (plan §14.4 #5, load-bearing for
 * §15.5). The Stage-2 `automation-dispatch` queue relies on BullMQ
 * redelivering a job whose worker died holding it (in-flight crash recovery
 * via stalled-job redelivery, §17). This pins that third-party contract: a
 * worker that claims a job and then DIES without completing it (we close it
 * mid-flight while suppressing lock renewal via a long processing block)
 * must have its job redelivered to a second worker and completed exactly
 * once.
 *
 * To make the stall observable in a bounded test, the worker is configured
 * with a short `lockDuration` + `stalledInterval` (the production worker uses
 * 30s, §15.4 — too long for a test). We assert the SECOND worker eventually
 * completes the job and that the side effect happens once.
 *
 * Gated behind `CHECKSTACK_IT=1` so the default `bun test` never runs it.
 * Connection comes from `CHECKSTACK_IT_REDIS_URL` (defaulting to the
 * `docker-compose-dev.yml` Redis port).
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

const QUEUE = `it_stage2_${crypto.randomUUID().replace(/-/g, "")}`;
const PREFIX = `it:${crypto.randomUUID().replace(/-/g, "")}`;

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "Stage-2 stalled redelivery (real Redis)",
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
      for (const w of workers) await w.close().catch(() => {});
      await queue.obliterate({ force: true }).catch(() => {});
      await queue.close();
    });

    it("a dead worker's job is redelivered to another worker and completed once", async () => {
      let completedBy = 0;
      const completions: string[] = [];

      // Short lock + stalled interval so the stall is observable quickly.
      const sharedOpts = {
        connection: redisConnection(),
        prefix: PREFIX,
        lockDuration: 1000,
        stalledInterval: 1000,
        maxStalledCount: 1,
      } as const;

      // Worker A: claims the job, then "dies" — it never resolves its
      // processor (simulating a crash). We force-close it (without letting it
      // finish) so the lock expires and BullMQ marks the job stalled.
      //
      // Determinism: with a single job and one healthy worker, starting BOTH
      // workers up front lets BullMQ hand the job to EITHER one — a healthy B
      // claim makes the "A dies mid-flight → B redelivers" assertion flaky even
      // though production is correct. So we start ONLY A, wait until it has
      // claimed the job, and only THEN start B and kill A. A is the guaranteed
      // first claimer, and the real stalled-redelivery path is still exercised.
      let aClaimed = false;
      const workerA = new Worker(
        QUEUE,
        async () => {
          aClaimed = true;
          // Block far longer than lockDuration without renewing — simulate a
          // hung/dead processor. The close() below pulls the rug out.
          await new Promise((r) => setTimeout(r, 60_000));
        },
        sharedOpts,
      );
      workers.push(workerA);

      await workerA.waitUntilReady();

      await queue.add("dispatch", { reason: "wake", runId: "run-1" });

      // Wait until A has claimed it (A is the only worker, so it WILL claim).
      const start = Date.now();
      while (!aClaimed && Date.now() - start < 5000) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(aClaimed).toBe(true);

      // Only now start worker B — the healthy worker that should redeliver +
      // complete the stalled job. Starting it after A claimed guarantees the
      // job is not handed to B first.
      const workerB = new Worker(
        QUEUE,
        async (job) => {
          completedBy += 1;
          completions.push(String(job.id));
        },
        sharedOpts,
      );
      workers.push(workerB);
      await workerB.waitUntilReady();

      // Kill worker A mid-flight (the rug-pull) so its lock can't renew.
      await workerA.close(true);

      // Wait for the stalled job to be redelivered to + completed by B.
      const waitStart = Date.now();
      while (completedBy === 0 && Date.now() - waitStart < 15_000) {
        await new Promise((r) => setTimeout(r, 100));
      }

      expect(completedBy).toBe(1);
      expect(completions).toHaveLength(1);
    });
  },
);
