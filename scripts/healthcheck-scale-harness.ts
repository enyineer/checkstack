#!/usr/bin/env bun
/**
 * Health-check scale harness.
 *
 * Drives the REAL hot path so the two health-check scaling ceilings can be
 * measured with numbers instead of theory. Composes real components: the
 * in-memory queue (concurrency-gated), the real HTTP strategy (real TCP/TLS
 * connections to a local echo server), the real advisory-lock rollup path on the
 * real lock/admin pools, and a faithful copy of the scoped-db transaction shape
 * (BEGIN -> SET LOCAL search_path -> queries -> COMMIT). Enables metrics and
 * serves /metrics, so it also exercises the queue-backlog gauge live.
 *
 * Two modes (env `MODE`):
 *
 *   MODE=load (default) - slot saturation. N recurring checks at concurrency C;
 *   a `SLOW_FRAC` of them are unreachable (they abort at the timeout, pinning a
 *   concurrency slot for its full duration). Watch `pending` (backlog) grow while
 *   `lockWait` stays 0 - i.e. the first ceiling is slot saturation, not the DB.
 *   Set `BULKHEAD=1` (optional `LANE_CAP`) to engage the real slow-check lane +
 *   adaptive timeout (`evaluateSlowCheckAdmission`): a suspect system is admitted
 *   to a capped lane or DEFERRED (recording nothing), so slot-hogging checks stop
 *   starving the healthy ones and the backlog stays bounded. Compare the
 *   `finalBacklog` of a `BULKHEAD=0` vs `BULKHEAD=1` run at the same load.
 *
 *   MODE=lockpool - the xact-lock ceiling. Fire M rollup writes (advisory
 *   xact-lock + scoped tx) at increasing concurrency K against the lock pool
 *   (max 10). Throughput plateaus once K passes the pool max; extra concurrency
 *   only adds lock-wait.
 *
 * Requires the dev database (docker compose -f docker-compose-dev.yml up -d) and
 * `DATABASE_URL` to be set (the backend pools are built at import time and throw
 * without it). Uses an isolated `scale_harness` schema, dropped on exit.
 *
 * Root scripts import workspace code via relative SOURCE paths (there is no
 * `@checkstack/*` symlink at the repo root, and third-party deps like `pg` are
 * not hoisted here) - so the DB layer reuses the pools EXPORTED by the backend
 * rather than importing `pg`/`drizzle` directly. See scripts/generate-sdk.ts.
 *
 * Examples:
 *   DATABASE_URL=postgres://checkstack:checkstack@localhost:5432/checkstack \
 *     MODE=load N=240 INTERVAL=8 CONC=10 SLOW_FRAC=0.2 TIMEOUT=5000 DURATION=35 \
 *     bun run scripts/healthcheck-scale-harness.ts
 *   DATABASE_URL=postgres://checkstack:checkstack@localhost:5432/checkstack \
 *     MODE=lockpool M=400 READS=3 bun run scripts/healthcheck-scale-harness.ts
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Logger } from "../core/common/src/logger.ts";
import { createAdvisoryLockService } from "../core/backend-api/src/advisory-lock.ts";
import { healthcheckExecutionHistogram } from "../core/backend-api/src/instrumentation.ts";
import { InMemoryQueue } from "../plugins/queue-memory-backend/src/memory-queue.ts";
import { HttpHealthCheckStrategy } from "../plugins/healthcheck-http-backend/src/strategy.ts";
import { adminPool, lockPool } from "../core/backend/src/db.ts";
import {
  startMetrics,
  registerQueueInstruments,
} from "../core/backend/src/instrumentation-sdk.ts";
import { computeScheduleJitterSeconds } from "../core/healthcheck-backend/src/schedule-jitter.ts";
import { SuspectLane } from "../core/healthcheck-backend/src/suspect-lane.ts";
import { evaluateSlowCheckAdmission } from "../core/healthcheck-backend/src/slow-check-admission.ts";
import type { RecentRun } from "../core/healthcheck-backend/src/slow-check-classifier.ts";

/**
 * The subset of a pooled pg client the harness uses. Declared locally rather
 * than imported from `pg`: a root script cannot resolve pg's types (not hoisted
 * at the repo root), and `ReturnType<typeof pool.connect>` picks pg's callback
 * overload (which returns `void`), not the `Promise<PoolClient>` one. The real
 * client returned by `adminPool.connect()` is structurally assignable to this.
 */
interface PgClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
  release(): void;
}

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
const pct = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]!);
};

const MODE = process.env.MODE ?? "load";
const SCHEMA = "scale_harness";

const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const advisoryLock = createAdvisoryLockService(lockPool);

/** Run `total` tasks across `concurrency` workers, each pulling the next index. */
async function forEachConcurrent(
  total: number,
  concurrency: number,
  task: (index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < total) {
      const index = next++;
      await task(index);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

/**
 * Reproduce the scoped-db proxy's transaction shape exactly (BEGIN -> SET LOCAL
 * search_path -> body -> COMMIT) on a real adminPool connection, so the rollup
 * write exercises the same statement sequence production does - without a direct
 * drizzle dependency at the repo root.
 */
async function scopedTx(body: (client: PgClient) => Promise<void>): Promise<void> {
  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO ${SCHEMA}`);
    await body(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** One completed run's DB work: rollup under a per-system xact advisory lock. */
async function rollupWrite(systemId: string, reads: number): Promise<void> {
  await advisoryLock.withXactLock({
    key: `health:${systemId}`,
    fn: () =>
      scopedTx(async (client) => {
        for (let r = 0; r < reads; r++) {
          await client.query("SELECT count(*) FROM runs WHERE system_id = $1", [
            systemId,
          ]);
        }
        await client.query(
          "INSERT INTO runs (system_id, ts) VALUES ($1, now())",
          [systemId],
        );
      }),
  });
}

async function createSchema(): Promise<void> {
  await adminPool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await adminPool.query(`CREATE SCHEMA ${SCHEMA}`);
  await adminPool.query(
    `CREATE TABLE ${SCHEMA}.runs (id serial primary key, system_id text not null, ts timestamptz not null default now())`,
  );
}

async function dropSchema(): Promise<void> {
  await adminPool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
}

async function shutdown(): Promise<void> {
  await adminPool.end();
  await lockPool.end();
}

// ── MODE=lockpool: the advisory-lock-pool throughput ceiling ──
async function runLockpool(): Promise<void> {
  const M = num("M", 400);
  const READS = num("READS", 3);
  await createSchema();
  await rollupWrite("warm", READS); // warm pools + JIT
  console.log(
    `MODE=lockpool lockPool.max=${lockPool.options.max} adminPool.max=${adminPool.options.max} M=${M} writes READS=${READS} under lock`,
  );
  console.log(" K   totalMs  throughput/s  maxLockWait  maxAdmWait");
  for (const K of [5, 10, 20, 40, 80]) {
    let maxLockWait = 0;
    let maxAdmWait = 0;
    const sampler = setInterval(() => {
      maxLockWait = Math.max(maxLockWait, lockPool.waitingCount);
      maxAdmWait = Math.max(maxAdmWait, adminPool.waitingCount);
    }, 5);
    const start = performance.now();
    await forEachConcurrent(M, K, (i) => rollupWrite(`sys-${i}`, READS));
    const totalMs = performance.now() - start;
    clearInterval(sampler);
    const tput = Math.round((M / totalMs) * 1000);
    console.log(
      ` ${String(K).padStart(2)}  ${String(Math.round(totalMs)).padStart(7)}  ${String(tput).padStart(12)}  ${String(maxLockWait).padStart(11)}  ${String(maxAdmWait).padStart(10)}`,
    );
  }
  await dropSchema();
  await shutdown();
}

// ── MODE=load: queue slot saturation under slow/unreachable checks ──
async function runLoad(): Promise<void> {
  const N = num("N", 240);
  const INTERVAL = num("INTERVAL", 8);
  const CONC = num("CONC", 10);
  const SLOW_FRAC = num("SLOW_FRAC", 0.2);
  const TIMEOUT = num("TIMEOUT", 5000);
  const DURATION = num("DURATION", 35);
  // BULKHEAD=1 engages the real slow-check lane + adaptive timeout in the
  // consume handler (via evaluateSlowCheckAdmission), so a suspect (repeatedly
  // slow-failing) system is admitted to a capped lane or DEFERRED — freeing
  // slots for healthy checks. LANE_CAP sizes the pod-local lane.
  const BULKHEAD = num("BULKHEAD", 0) === 1;
  const LANE_CAP = Math.max(1, num("LANE_CAP", 3));
  const lane = new SuspectLane(LANE_CAP);
  const recentBySystem = new Map<string, RecentRun[]>();
  let deferrals = 0;
  process.env.CHECKSTACK_METRICS_ENABLED = "1";
  process.env.CHECKSTACK_METRICS_PORT =
    process.env.CHECKSTACK_METRICS_PORT ?? "19464";

  await createSchema();

  // Local echo server: /fast responds immediately, /slow?ms=X after X ms.
  // Slow requests delay LONGER than the timeout, so the fetch aborts at TIMEOUT
  // - i.e. they pin their concurrency slot for the full timeout (unreachable).
  // The delay is a fixed server-side constant keyed on the path (`/slow` vs
  // `/fast`); it is NOT read from the request, so no request-controlled value
  // ever reaches setTimeout.
  const SLOW_DELAY_MS = TIMEOUT + 5000;
  const echo = http.createServer((req, res) => {
    const isSlow = (req.url ?? "/").startsWith("/slow");
    const send = (): void => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    };
    if (isSlow) setTimeout(send, SLOW_DELAY_MS);
    else send();
  });
  await new Promise<void>((resolve) => echo.listen(0, "127.0.0.1", () => resolve()));
  const echoPort = (echo.address() as AddressInfo).port;
  const fastUrl = `http://127.0.0.1:${echoPort}/fast`;
  const slowUrl = `http://127.0.0.1:${echoPort}/slow`;

  const loopbackLookup = async (
    _hostname: string,
  ): Promise<Array<{ address: string; family: number }>> => [
    { address: "127.0.0.1", family: 4 },
  ];
  const strategy = new HttpHealthCheckStrategy(loopbackLookup);

  startMetrics();

  const queue = new InMemoryQueue<{ systemId: string; slow: boolean }>(
    "health-checks",
    {
      concurrency: CONC,
      maxQueueSize: 1_000_000,
      delayMultiplier: 1,
      heartbeatIntervalMs: 100,
    },
    noopLogger,
  );
  registerQueueInstruments({
    queueManager: { getAggregatedStats: () => queue.getStats() },
  });

  const latencies: number[] = [];
  let completions = 0;
  let timeouts = 0;

  await queue.consume(
    async (job) => {
      const sys = job.data.systemId;
      let effectiveTimeout = TIMEOUT;
      let laneKey: string | undefined;
      if (BULKHEAD) {
        const decision = evaluateSlowCheckAdmission({
          runtime: {
            lane,
            recentRunsLimit: 20,
            classifierParams: {
              consecutiveFailures: 3,
              slowFraction: 0.8,
              recoveryProbeEvery: 5,
            },
            safetyFactor: 1.5,
            absoluteFloorMs: 1000,
          },
          recentRuns: recentBySystem.get(sys) ?? [],
          configId: "cfg",
          systemId: sys,
          environmentId: null,
          executionTimeoutMs: TIMEOUT,
        });
        if (decision.kind === "defer") {
          deferrals++; // record nothing — the slot is freed for healthy checks
          return;
        }
        effectiveTimeout = decision.effectiveTimeoutMs;
        laneKey = decision.laneKey;
      }
      const t0 = performance.now();
      let status: "healthy" | "unhealthy" = "healthy";
      const client = await strategy.createClient({ timeout: effectiveTimeout });
      try {
        await client.client.exec({
          url: job.data.slow ? slowUrl : fastUrl,
          method: "GET",
          timeout: effectiveTimeout,
        });
      } catch {
        timeouts++; // aborted/timed out - a completed (failed) check; slot held
        status = "unhealthy";
      } finally {
        client.close();
      }
      await rollupWrite(sys, 0);
      const dt = performance.now() - t0;
      latencies.push(dt);
      completions++;
      if (BULKHEAD) {
        const arr = recentBySystem.get(sys) ?? [];
        arr.unshift({ environmentId: null, status, latencyMs: dt, timestamp: new Date() });
        if (arr.length > 20) arr.pop();
        recentBySystem.set(sys, arr);
        if (laneKey) lane.release(laneKey);
      }
      healthcheckExecutionHistogram().record(dt, { status });
    },
    { consumerGroup: "harness", maxRetries: 0 },
  );

  // Schedule N recurring checks with the real jitter.
  for (let i = 0; i < N; i++) {
    const systemId = `sys-${i}`;
    const slow = i / N < SLOW_FRAC;
    // Seed the slow systems' recent history as already slow-failing so the
    // bulkhead classifies them suspect from the FIRST tick — the realistic
    // "host was already down when this pod started" case. Without seeding,
    // the in-memory history takes ~3 five-second runs (~15s+ under backlog) to
    // warm up, which a short harness run never reaches; production has the
    // durable history on tick one.
    if (BULKHEAD && slow) {
      recentBySystem.set(
        systemId,
        Array.from({ length: 3 }, () => ({
          environmentId: null,
          status: "unhealthy" as const,
          latencyMs: TIMEOUT,
          timestamp: new Date(),
        })),
      );
    }
    const startDelay = computeScheduleJitterSeconds({
      key: systemId,
      intervalSeconds: INTERVAL,
    });
    await queue.scheduleRecurring(
      { systemId, slow },
      { jobId: `hc:${systemId}`, intervalSeconds: INTERVAL, startDelay },
    );
  }

  console.log(
    `MODE=load N=${N} interval=${INTERVAL}s conc=${CONC} slowFrac=${SLOW_FRAC} timeout=${TIMEOUT}ms duration=${DURATION}s ` +
      `bulkhead=${BULKHEAD ? `on(cap=${LANE_CAP})` : "off"}`,
  );
  console.log(`offered load = ${(N / INTERVAL).toFixed(1)} checks/s`);
  console.log("t  pending processing lockWait admWait  done/s  p50  p99");
  let lastDone = 0;
  for (let t = 1; t <= DURATION; t++) {
    await sleep(1000);
    const stats = await queue.getStats();
    const doneNow = completions - lastDone;
    lastDone = completions;
    const recent = latencies.slice(-200);
    console.log(
      `${String(t).padStart(2)}  ${String(stats.pending).padStart(7)} ${String(stats.processing).padStart(10)} ${String(lockPool.waitingCount).padStart(8)} ${String(adminPool.waitingCount).padStart(6)}  ${String(doneNow).padStart(6)}  ${String(pct(recent, 50)).padStart(4)} ${String(pct(recent, 99)).padStart(5)}`,
    );
  }

  const finalStats = await queue.getStats();
  console.log(
    `\nSUMMARY: completions=${completions} timeouts=${timeouts} deferrals=${deferrals} ` +
      `p50=${pct(latencies, 50)}ms p99=${pct(latencies, 99)}ms finalBacklog=${finalStats.pending}`,
  );

  await queue.stop();
  echo.close();
  await dropSchema();
  await shutdown();
}

async function main(): Promise<void> {
  await (MODE === "lockpool" ? runLockpool() : runLoad());
}

await main();

process.exit(0);
