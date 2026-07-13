/**
 * LOAD GUARD (integration): high-volume ingest must NOT degrade the rest of the
 * application's responsiveness.
 *
 * This is a responsiveness regression guard, not a throughput benchmark. It
 * drives the REAL end-to-end ingest path against REAL Postgres - the native
 * HTTP handler (auth -> parse/normalize -> pipeline buffer) plus the Phase-D
 * stream-sharded WORKER POOL (the offloadable stage: drain classify ->
 * severity/pattern folds -> sampling -> FlushPlan) and the main thread's write
 * (one transaction -> storage) - and MEASURES that the shared process and the
 * shared DB pool stay responsive under load. It FAILS if ingestion starves the
 * event loop or the pool, drops accepted data, or fails to shed overload. The
 * pool runs at the shipped default (poolSize 1); override with
 * CHECKSTACK_IT_LOAD_WORKERS.
 *
 * THREE PHASES, deliberately separated (see the design note at the bottom of this
 * file for the full rationale):
 *
 *   Phase A - RESPONSIVENESS under sustained high (absorbable) load. Producers
 *   are paced to a genuinely high but sustainable rate (~10k lines/s, well above
 *   the requirement's 3-5k floor) that the pipeline fully accepts. This is the
 *   regime where "does high volume degrade the app?" actually lives, and it is
 *   where the event-loop bound is meaningful AND stable across machines. We
 *   assert a tight event-loop p95 and a fast control-path probe here.
 *
 *   Phase A2 - RESPONSIVENESS at ~2x Phase A (the worker-offload payoff). With
 *   classify + fold + sample on the worker pool, doubling the offered rate to
 *   ~20k lines/s must keep the main event loop within the SAME bound as Phase A.
 *   Measured ~8-10ms p95 locally at ~20k lines/s (vs the tight Phase A bound),
 *   because the heavy per-line work no longer runs on the main thread at all.
 *
 *   Phase B - BACKPRESSURE under overload burst. Producers then hammer as fast
 *   as the process allows (far above the drain rate) for a short burst. We assert
 *   the shed path (429s appear, every offered line is accounted for, RSS stays
 *   bounded) AND a GENEROUS event-loop bound: the flush classify loop yields the
 *   event loop every 500 lines (`prepareFlush`), so a full-buffer flush no longer
 *   monopolizes the loop. Before that yield existed the overload regime measured
 *   ~270ms p95 (a full `bufferCap` classified in one synchronous loop) and this
 *   phase carried NO loop bound; with yielding it measures ~16ms p95, so the
 *   bound here is looser than Phase A's only for CI-runner headroom, not because
 *   the regime is intrinsically janky. Removing the yield trips it.
 *
 * What each bound catches:
 *   - Phase A event-loop p95: a regression that moves per-line work onto the
 *     synchronous main thread (per-line synchronous DB calls, or synchronous
 *     gzip/hashing of whole bodies in the request path) would push the loop
 *     delay far past the bound even at this absorbable rate.
 *   - Phase B (overload burst) event-loop p95: the yield-chunked classify loop
 *     keeps the loop responsive even while shedding a full buffer. Removing the
 *     periodic yield (classifying the whole buffer in one synchronous loop)
 *     regresses to the pre-yield ~270ms and trips this (generous) bound.
 *   - Control-path (non-ingest) probe latency + zero failures (BOTH phases): a
 *     representative read on the SAME db pool (`getStream`). If the flush path
 *     held pool connections too long or blocked the loop, this probe - the
 *     direct proxy for "the rest of the app" - would slow down or time out.
 *   - Backpressure accounting + bounded memory (Phase B): overload is SHED as
 *     429s; accepted + rejected == offered; RSS growth stays bounded.
 *   - Post-load integrity: after a final flush the persisted severity-bucket
 *     total equals the accepted line count (no accepted data lost), and the
 *     stream activity row was updated.
 *
 * LANE: runs in the standard integration lane (`CHECKSTACK_IT=1 bun test
 * it.test`, real Postgres + Redis service containers - see
 * `.github/workflows/pr-checks.yml`), like every other `*.it.test.ts`. It uses
 * its OWN throwaway schema (via `withTestDb`) and its own stream id, so it never
 * contends with the other IT files' data. Phase A's measured window defaults to
 * ~10s; override with `CHECKSTACK_IT_LOAD_MS` for a quicker local pass, e.g.
 * `CHECKSTACK_IT_LOAD_MS=3000 CHECKSTACK_IT=1 bun test load-guard`.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import {
  withTestDb,
  isIntegrationEnabled,
  createMockLogger,
  createMockSignalService,
  type TestDb,
} from "@checkstack/test-utils-backend";
import type { CacheManager, CacheProvider } from "@checkstack/cache-api";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  SEVERITY_BANDS,
  type LogStreamConfig,
  type SeverityBand,
} from "@checkstack/logstream-common";
import { generateToken } from "../token-crypto";
import type { InstanceRuntime } from "@checkstack/backend-api";
import * as schema from "../schema";
import { createStorage } from "../storage";
import { readStreamActivity, sumSeverityBands } from "../storage";
import { createImportantEventRecorder } from "../events/recorder";
import { createDrainEngine } from "../drain/engine";
import { createLogstreamService, type LogstreamService } from "../api/service";
import { createIngestTokenCache } from "../api/token-cache";
import { createIngestAuthenticator } from "./auth";
import { lookupTokenByHash } from "./token-lookup";
import { createStreamConfigResolver } from "./stream-config";
import { createIngestPipeline, type IngestPipeline } from "./pipeline";
import {
  createInProcessFlushExecutor,
  type FlushExecutor,
} from "./flush-executor";
import { createWorkerFlushExecutor } from "./worker/pool";
import { createDbPatternLoader } from "./worker/db-loader";
import { createNativeIngestHandler } from "./endpoints/native";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");
const STREAM = "load-guard-stream";
const CREATED = new Date("2026-01-01T00:00:00.000Z");
const INGEST_URL = "http://localhost/api/logstream/ingest";

// Load shape.
const PRODUCERS = 8; // concurrent "connections" POSTing continuously
const BATCH_LINES = 200; // NDJSON lines per POST
const WARMUP_MS = 2000; // let JIT/caches settle before measuring
const MEASURE_MS = Number(process.env.CHECKSTACK_IT_LOAD_MS ?? 10_000); // Phase A
const BURST_MS = 3000; // Phase B overload burst
const PROBE_INTERVAL_MS = 200;

// Phase A pacing: each producer sends a 200-line batch then sleeps this long,
// so 8 producers offer ~= 8 * 200 / (SUSTAIN_PACING_MS/1000) lines/s. 150ms
// targets ~10.5k lines/s - genuinely high (>2x the 3-5k floor) yet comfortably
// below the pipeline's drain ceiling on any machine (batched ~1k-line flushes a
// few times per second is trivial for Postgres), so the buffer stays small and
// the loop stays calm. A tighter pace risks a slow CI box shedding mid-Phase-A,
// which would (correctly) reflect the overload regime and destabilize the bound.
const SUSTAIN_PACING_MS = 150;
const SUSTAIN_MIN_PER_SEC = 5000; // fail if we did not actually sustain high load

// Phase A2 pacing: HALF the Phase A pacing => ~2x the offered rate (~21k lines/s
// with 8 producers x 200 lines / 75ms). This is the worker-offload payoff phase:
// with classify moved to the worker pool, the main event loop must stay just as
// calm at 2x the offered rate as it does in Phase A. If a machine cannot ABSORB
// 2x with the default single worker it will shed here - and because classify is
// off the main thread, the loop stays calm even while shedding, so the bound
// still holds (that is precisely the property this phase proves).
const SUSTAIN_PACING_MS_A2 = 75;
// Floor proving we genuinely OFFERED ~2x (offered counts before the handler, so
// it holds regardless of absorption); headroom below the ~21k target for slow CI.
const SUSTAIN_MIN_PER_SEC_A2 = 15_000;

// Bounds. p95 (not max) with headroom so a healthy machine - including a
// 2-core CI runner under its own load - passes comfortably, while a real
// responsiveness regression (per-line sync DB work, sync gzip/hash on the
// request path, flush holding the loop/pool) blows well past them. Calibrated
// against measured baselines: Phase A event-loop p95 ~19ms locally (so 150ms is
// ~8x headroom); probe p95 a few ms in both phases.
const EVENT_LOOP_P95_MAX_MS = 150; // Phase A (absorbable load): low-tens of ms healthy
// Phase B (overload burst): with the yield-chunked classify loop (prepareFlush
// yields every 500 lines), the shed regime no longer monopolizes the loop.
// Measured p95 ~16ms locally under a ~150k lines/s firehose (max ~33ms), vs
// ~270ms BEFORE yielding was added. 120ms sits well below that pre-yield
// baseline - so REMOVING the yield fails this guard - while keeping ~7x headroom
// over the measured p95 for a loaded 2-core CI runner.
const EVENT_LOOP_P95_MAX_BURST_MS = 120;
const PROBE_P95_MAX_MS = 750; // healthy: a few ms; a starved pool -> seconds
const RSS_GROWTH_MAX_BYTES = 300 * 1024 * 1024; // buffer byte-cap is the OOM guard

describe.skipIf(!isIntegrationEnabled())(
  "logstream ingest load guard (integration)",
  () => {
    let test: TestDb<typeof schema>;
    let pipeline: IngestPipeline;
    let executor: FlushExecutor;
    let service: LogstreamService;
    let handler: (request: Request) => Promise<Response>;
    let tokenSecret: string;

    beforeAll(async () => {
      test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
      const { db } = test;

      // A stream whose soft rate limit is effectively unlimited, so the BUFFER
      // (not the rate limiter) is the backpressure mechanism under test - that
      // is the path that must shed to 429 and bound memory. Everything else is
      // the shipped default policy.
      const config: LogStreamConfig = {
        ...DEFAULT_LOG_STREAM_CONFIG,
        softRateLimitPerMinute: 10_000_000,
      };
      await db.insert(schema.logStreams).values({
        id: STREAM,
        name: "Load Guard IT",
        config,
        createdAt: CREATED,
        updatedAt: CREATED,
      });

      const token = generateToken({ streamId: STREAM });
      tokenSecret = token.secret;
      await db.insert(schema.logStreamTokens).values({
        id: "load-guard-token",
        streamId: STREAM,
        name: "load shipper",
        tokenHash: token.tokenHash,
        tokenPrefix: token.tokenPrefix,
      });

      const logger = createMockLogger();
      const signalService = createMockSignalService();
      const cacheManager = createInMemoryCacheManager();
      const storage = createStorage({ db });
      const recorder = createImportantEventRecorder({ db, signalService, logger });
      const drain = createDrainEngine({
        storage,
        cacheManager,
        // Unused on the classify/hydrate paths this test drives (mirrors
        // drain/engine.test.ts).
        instanceRuntime: undefined as unknown as InstanceRuntime,
        logger,
      });

      // Drive the Phase-D WORKER path: the offloadable flush stage (classify +
      // fold + sample) runs on a real Bun worker pool, so this guard measures
      // the shipped default (poolSize 1) - override with CHECKSTACK_IT_LOAD_WORKERS.
      // The in-process executor stays wired as the crash/degradation fallback,
      // and main answers the workers' hydrate-requests from this test's DB.
      const poolSize = Number(process.env.CHECKSTACK_IT_LOAD_WORKERS ?? 1);
      executor = createWorkerFlushExecutor({
        poolSize,
        loadPatternRows: createDbPatternLoader({ storage, logger }),
        fallback: createInProcessFlushExecutor({ drain, logger }),
        logger,
      });

      pipeline = createIngestPipeline({
        db,
        storage,
        drain,
        executor,
        recorder,
        signalService,
        logger,
        // The health fast-path hook is exercised by health.it.test.ts; here it
        // must simply not throw so the flush's post-commit fan-out runs.
        onIngestFlush: () => {},
      });
      pipeline.start();

      const cache = createIngestTokenCache({ cacheManager });
      const auth = createIngestAuthenticator({
        lookup: (tokenHash) => lookupTokenByHash({ db, tokenHash }),
        cache,
      });
      const configResolver = createStreamConfigResolver({ db, cache });
      handler = createNativeIngestHandler({ auth, configResolver, pipeline, logger });

      service = createLogstreamService({
        db,
        storage,
        cacheManager,
        logger,
      });
    });

    afterAll(async () => {
      pipeline?.stop();
      await executor?.stop();
      await test?.dispose();
    });

    it("stays responsive under sustained high ingest, and sheds overload without crashing or losing accepted data", async () => {
      const authorization = `Bearer ${tokenSecret}`;

      // ---- Shared load + measurement state ------------------------------
      let running = true;
      const pace = { ms: SUSTAIN_PACING_MS }; // producers read this every loop
      const offered = { lines: 0 };
      const acceptedLines = { total: 0 };
      const rejectedBufferPartial = { total: 0 }; // partial-fill rejects (202 body)
      const rejected429 = { lines: 0 }; // whole-batch sheds (429)
      let measuringProbe = false; // gate probe samples to the measured window

      const probeLatencies: number[] = [];
      let probeFailures = 0;
      let probeCount = 0;

      // Precompute a POOL of ready NDJSON batch strings so the load generator
      // itself does not allocate ~1.5M JSON strings during the measured window
      // (that garbage, and its GC pauses, would contaminate the event-loop
      // measurement with the HARNESS's cost rather than INGESTION's). The pool
      // still carries realistic variety (bounded template vocabulary, mixed
      // severities); the handler re-parses each string, so per-request parse
      // cost - a genuine part of the ingest path - is preserved.
      const POOL_SIZE = 64;
      const batchPool = Array.from({ length: POOL_SIZE }, (_, k) =>
        buildNdjsonBatch({ producerId: k % PRODUCERS, seq: k, count: BATCH_LINES }),
      );

      // ---- Producers: real end-to-end POSTs to the native handler --------
      async function produce(producerId: number): Promise<void> {
        let seq = 0;
        while (running) {
          const body = batchPool[(producerId * 13 + seq++) % POOL_SIZE];
          offered.lines += BATCH_LINES;
          let res: Response;
          try {
            res = await handler(
              new Request(INGEST_URL, {
                method: "POST",
                headers: { authorization, "content-type": "application/x-ndjson" },
                body,
              }),
            );
          } catch {
            // A thrown handler would itself be a crash-under-load failure; count
            // the batch as neither accepted nor shed so the accounting assertion
            // below trips loudly.
            continue;
          }
          if (res.status === 202) {
            const parsed = (await res.json()) as { accepted: number; rejected: number };
            acceptedLines.total += parsed.accepted;
            rejectedBufferPartial.total += parsed.rejected;
          } else if (res.status === 429) {
            rejected429.lines += BATCH_LINES;
          } else {
            // Unexpected status: leave it unaccounted so the sum assertion fails.
          }
          // Pace to the current target (150ms in Phase A, 0 in the Phase B
          // burst); sleep(0) still yields, so producers never monopolize the loop.
          await sleep(pace.ms);
        }
      }

      // ---- Control path: a representative non-ingest read on the SAME pool
      async function probe(): Promise<void> {
        while (running) {
          const startedAt = performance.now();
          try {
            await service.getStream({ id: STREAM });
            if (measuringProbe) probeLatencies.push(performance.now() - startedAt);
          } catch {
            if (measuringProbe) probeFailures += 1;
          }
          if (measuringProbe) probeCount += 1;
          await sleep(PROBE_INTERVAL_MS);
        }
      }

      const loopDelay = monitorEventLoopDelay({ resolution: 10 });
      loopDelay.enable();

      const producers = Array.from({ length: PRODUCERS }, (_, i) => produce(i));
      const probing = probe();

      // Warm up (JIT, token/config cache fill, pool ramp) BEFORE measuring.
      await sleep(WARMUP_MS);

      // =====================================================================
      // PHASE A - responsiveness under sustained, absorbable high load
      // =====================================================================
      loopDelay.reset();
      probeLatencies.length = 0;
      probeFailures = 0;
      probeCount = 0;
      measuringProbe = true; // probe is measured through BOTH phases
      const offeredAtPhaseAStart = offered.lines;

      const phaseAStartedAt = performance.now();
      await sleep(MEASURE_MS);
      const phaseAMs = performance.now() - phaseAStartedAt;

      // Read the event-loop histogram NOW, before the overload burst: the tight
      // event-loop bound is only meaningful in the absorbable regime (see the
      // design note at the bottom of the file).
      const eventLoopP95Ms = loopDelay.percentile(95) / 1e6;
      const eventLoopMeanMs = loopDelay.mean / 1e6;
      const eventLoopMaxMs = loopDelay.max / 1e6;
      const offeredPerSecA = Math.round(
        (offered.lines - offeredAtPhaseAStart) / (phaseAMs / 1000),
      );

      // =====================================================================
      // PHASE A2 - responsiveness under ~2x Phase A (the worker-offload payoff)
      // =====================================================================
      // Measure the event loop in its OWN window at double the offered rate.
      // With classify + fold + sample on the worker pool, the main loop should
      // stay within the SAME bound as Phase A even at 2x the rate.
      loopDelay.reset();
      const offeredAtPhaseA2Start = offered.lines;
      pace.ms = SUSTAIN_PACING_MS_A2;

      const phaseA2StartedAt = performance.now();
      await sleep(MEASURE_MS);
      const phaseA2Ms = performance.now() - phaseA2StartedAt;

      const eventLoopP95A2Ms = loopDelay.percentile(95) / 1e6;
      const eventLoopMeanA2Ms = loopDelay.mean / 1e6;
      const eventLoopMaxA2Ms = loopDelay.max / 1e6;
      const offeredPerSecA2 = Math.round(
        (offered.lines - offeredAtPhaseA2Start) / (phaseA2Ms / 1000),
      );

      // =====================================================================
      // PHASE B - backpressure under an overload burst
      // =====================================================================
      const rssBeforeBurst = process.memoryUsage().rss;
      const offeredBeforeBurst = offered.lines;
      const rejected429BeforeBurst = rejected429.lines;

      // Measure the overload burst's event-loop delay in its OWN window: the
      // yield-chunked classify loop (prepareFlush yields every 500 lines) must
      // keep the loop from being monopolized even while the buffer is full and
      // shedding. Reset the histogram so this reads only the burst.
      loopDelay.reset();
      pace.ms = 0; // unleash: offer far above the drain rate
      await sleep(BURST_MS);
      const rssBurstPeak = process.memoryUsage().rss;
      const eventLoopP95BurstMs = loopDelay.percentile(95) / 1e6;
      const eventLoopMaxBurstMs = loopDelay.max / 1e6;

      const burstOffered = offered.lines - offeredBeforeBurst;
      const burst429 = rejected429.lines - rejected429BeforeBurst;
      const rssGrowthBytes = rssBurstPeak - rssBeforeBurst;

      // Stop producing/probing and let the last in-flight iterations settle so
      // every offered batch is counted before we reconcile.
      running = false;
      await Promise.all([...producers, probing]);
      loopDelay.disable();

      // Drain the buffer tail into storage (three sequential flushes: the first
      // may return an already-inflight cycle that drained an earlier snapshot,
      // the rest guarantee the remainder lands - mirrors teardown's final flush).
      await pipeline.flushNow();
      await pipeline.flushNow();
      await pipeline.flushNow();

      const probeP95Ms = percentile(probeLatencies, 95);

      // Persisted severity total across ALL bands must equal accepted lines: the
      // flush increments exactly one severity bucket per classified line, so no
      // accepted line may be missing after the final flush.
      const totals = await sumSeverityBands({
        runner: test.db,
        streamId: STREAM,
        from: new Date(CREATED.getTime() - 60_000),
        to: new Date(Date.now() + 5 * 60_000),
        grain: "minute",
      });
      const persistedTotal = SEVERITY_BANDS.reduce(
        (sum, band: SeverityBand) => sum + totals[band],
        0,
      );
      const activity = await readStreamActivity({ runner: test.db, streamId: STREAM });

      // Surfaced so a CI run shows the actual numbers, not just a bare assertion.
      console.log(
        "[load-guard] " +
          JSON.stringify({
            phaseA: {
              offeredPerSec: offeredPerSecA,
              eventLoopMeanMs: round2(eventLoopMeanMs),
              eventLoopP95Ms: round2(eventLoopP95Ms),
              eventLoopMaxMs: round2(eventLoopMaxMs),
            },
            phaseA2: {
              offeredPerSec: offeredPerSecA2,
              eventLoopMeanMs: round2(eventLoopMeanA2Ms),
              eventLoopP95Ms: round2(eventLoopP95A2Ms),
              eventLoopMaxMs: round2(eventLoopMaxA2Ms),
            },
            phaseBurst: {
              offered: burstOffered,
              shed429: burst429,
              eventLoopP95Ms: round2(eventLoopP95BurstMs),
              eventLoopMaxMs: round2(eventLoopMaxBurstMs),
            },
            probeCount,
            probeP95Ms: round2(probeP95Ms),
            probeFailures,
            offeredTotal: offered.lines,
            acceptedLines: acceptedLines.total,
            rejected429Lines: rejected429.lines,
            rejectedBufferPartial: rejectedBufferPartial.total,
            rssGrowthMB: round2(rssGrowthBytes / (1024 * 1024)),
            persistedTotal,
          }),
      );

      // ---- Phase A: sustained load was genuinely high AND absorbed ---------
      // A floor on the OFFERED rate (in-process, so far above any single socket),
      // not a throughput SLO - if we did not sustain high load, the guard proved
      // nothing.
      expect(offeredPerSecA).toBeGreaterThanOrEqual(SUSTAIN_MIN_PER_SEC);

      // ---- Phase A: event loop stayed responsive under sustained load ------
      // The load here is fully absorbed, so a healthy pipeline keeps the loop at
      // low-tens of ms. A regression that puts per-line synchronous DB work or
      // whole-body sync gzip/hashing on the request/flush path would blow past
      // this bound even at this absorbable rate.
      expect(eventLoopP95Ms).toBeLessThanOrEqual(EVENT_LOOP_P95_MAX_MS);

      // ---- Phase A2: ~2x offered rate stayed just as responsive -------------
      // The worker offload is what makes this hold: classify is no longer on the
      // main thread, so doubling the offered rate does not push the loop past the
      // Phase A bound. If the default single worker cannot absorb 2x on this
      // machine it sheds, and the loop STILL stays calm (classify is off-thread).
      expect(offeredPerSecA2).toBeGreaterThanOrEqual(SUSTAIN_MIN_PER_SEC_A2);
      expect(eventLoopP95A2Ms).toBeLessThanOrEqual(EVENT_LOOP_P95_MAX_MS);

      // ---- Both phases: shared-pool control path stayed responsive ---------
      // The direct proxy for "the rest of the app": a non-ingest read on the same
      // pool, sampled throughout BOTH phases (including the overload burst). If
      // ingestion held pool connections or blocked the loop, this would slow or
      // fail.
      expect(probeCount).toBeGreaterThan(0);
      expect(probeFailures).toBe(0);
      expect(probeP95Ms).toBeLessThanOrEqual(PROBE_P95_MAX_MS);

      // ---- Phase B: backpressure - overflow shed, accounted, bounded RSS ---
      // The burst offers far above the drain rate, so the buffer MUST shed to 429
      // rather than buffer unboundedly.
      expect(burst429).toBeGreaterThan(0);
      // ...and the event loop stays responsive even while shedding: the
      // yield-chunked classify loop hands the loop back every 500 lines, so a
      // full-buffer flush can no longer monopolize it. Removing the yield
      // regresses this to the pre-yield ~270ms and trips the bound.
      expect(eventLoopP95BurstMs).toBeLessThanOrEqual(EVENT_LOOP_P95_MAX_BURST_MS);
      // Every offered line (both phases) is either accepted or rejected
      // (partial-fill or 429). A crash/leak in the request path breaks this.
      expect(
        acceptedLines.total + rejectedBufferPartial.total + rejected429.lines,
      ).toBe(offered.lines);
      // Memory growth during the burst stays bounded (the buffer byte cap is the
      // OOM guard); unbounded buffering would blow past this.
      expect(rssGrowthBytes).toBeLessThanOrEqual(RSS_GROWTH_MAX_BYTES);

      // ---- Post-load integrity: no accepted data lost ----------------------
      expect(acceptedLines.total).toBeGreaterThan(0);
      expect(persistedTotal).toBe(acceptedLines.total);
      expect(activity).not.toBeNull();
      expect(activity?.lastReceivedAt).toBeInstanceOf(Date);
    }, WARMUP_MS + MEASURE_MS * 2 + BURST_MS + 60_000);
  },
);

// ===========================================================================
// Helpers
// ===========================================================================

/** OTel level names Drain/normalize understand; weighted toward info/debug with
 * a realistic minority of warn/error so the flush exercises every band, spike
 * detection, and new-pattern events without an all-error firehose. */
const LEVELS: readonly string[] = [
  "info",
  "info",
  "info",
  "debug",
  "debug",
  "info",
  "warn",
  "error",
];

/**
 * A BOUNDED, realistic template vocabulary. A real log stream emits from a
 * finite set of call sites, so Drain's pattern set converges and per-line
 * classification cost stabilizes. (An unbounded, ever-growing pattern space is
 * not "high volume" - it is a different, pathological workload, and it would let
 * the in-memory parse tree grow without bound and make classify cost drift up
 * with duration rather than with rate.) Numbers/ids inside the templates are
 * masked by Drain into wildcards, so these collapse to a stable ~30 templates
 * while still varying the raw line bodies. */
const TEMPLATES: readonly ((n: number) => string)[] = [
  (n) => `service request template=1 status=ok latency=${n % 500}ms`,
  (n) => `service request template=2 status=ok latency=${n % 800}ms`,
  (n) => `user ${1000 + (n % 5000)} logged in from 10.0.${n % 255}.${n % 200}`,
  (n) => `user ${1000 + (n % 5000)} logged out session=${n % 9999}`,
  (n) => `cache hit key=item:${n % 4000} ttl=${n % 60}s`,
  (n) => `cache miss key=item:${n % 4000} loading from db`,
  (n) => `db query took ${n % 300}ms rows=${n % 100}`,
  (n) => `http GET /api/resource/${n % 2000} 200 in ${n % 250}ms`,
  (n) => `http POST /api/resource/${n % 2000} 201 in ${n % 400}ms`,
  (n) => `queue job ${n % 10_000} completed in ${n % 900}ms`,
  (n) => `payment ${n % 8000} authorized amount=${n % 500}.00`,
  (n) => `connection pool size=${n % 20} idle=${n % 10}`,
  (n) => `retrying request attempt=${n % 5} backoff=${n % 200}ms`,
  (n) => `timeout waiting for upstream after ${n % 1000}ms`,
  (n) => `disk usage ${n % 100}% on volume /data/${n % 8}`,
];

/**
 * Build one NDJSON batch with realistic variety: a bounded set of message
 * templates and mixed severities. `producerId`/`seq`/`idx` vary the numeric
 * tokens (which Drain masks) so raw line bodies differ while the pattern set
 * stays finite - the shape of genuine high-volume traffic.
 */
function buildNdjsonBatch({
  producerId,
  seq,
  count,
}: {
  producerId: number;
  seq: number;
  count: number;
}): string {
  const lines = Array.from({ length: count }, (_, i) => {
    const level = LEVELS[(producerId + seq + i) % LEVELS.length];
    const template = TEMPLATES[(producerId * 5 + seq + i) % TEMPLATES.length];
    const message = template(producerId * 131 + seq * 17 + i);
    return JSON.stringify({ level, message, producer: producerId, seq, idx: i });
  });
  return lines.join("\n");
}

/** Nearest-rank p95 over a copy of the samples (ms). Returns 0 for no samples. */
function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = samples.toSorted((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A minimal in-process {@link CacheManager} backing the ingest token + stream
 * config caches, so a warm token/config costs no DB round-trip during the load
 * (as in production, where these live in the shared platform cache). A plain
 * Map with per-key TTL; sufficient for this single-process test.
 */
function createInMemoryCacheManager(): CacheManager {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  const live = (key: string): unknown => {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== 0 && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  };
  const provider: CacheProvider = {
    get: async <T>(key: string) => live(key) as T | undefined,
    set: async (key, value, ttlMs) => {
      store.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : 0 });
    },
    delete: async (key) => {
      store.delete(key);
    },
    deleteByPrefix: async (prefix) => {
      let removed = 0;
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          store.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
    has: async (key) => live(key) !== undefined,
  };
  return { getProvider: () => provider } as unknown as CacheManager;
}

// ===========================================================================
// DESIGN NOTE - why two phases (and why the two loop bounds differ)
// ===========================================================================
//
// Measuring this pipeline revealed a structural property worth recording so a
// future reader understands why Phase A and Phase B assert DIFFERENT loop bounds
// (and does not collapse them or make the test flaky):
//
//   - At any OFFERED rate the pipeline can ABSORB (measured drain ceiling was
//     >~25k lines/s on the dev box; everything accepted, zero 429s), the event
//     loop stays calm: p95 ~8ms at 5k/s, ~19ms at ~10k/s, ~47ms at ~25k/s. High
//     sustainable volume does NOT degrade responsiveness. This is Phase A.
//
//   - Shedding (429) requires the bounded write buffer to be FULL. A full buffer
//     is exactly what each flush then drains and classifies (up to `bufferCap`,
//     default 20k lines, in one loop inside `prepareFlush`). BEFORE the classify
//     loop yielded, that loop ran fully synchronously and the overload regime
//     measured ~270ms p95 under a ~160k lines/s in-process firehose - so this
//     phase carried NO loop bound. The classify loop now yields the event loop
//     every 500 lines, capping the contiguous synchronous work regardless of how
//     full the buffer is, and the same firehose now measures ~16ms p95 (max
//     ~33ms). So Phase B DOES assert a loop bound - just a looser one than Phase
//     A, purely for 2-core-CI-runner headroom, not because the regime is janky.
//
// Hence: Phase A asserts the tight absorbable-load bound; Phase B asserts a
// generous overload bound that a full yield-removal (back to the whole-buffer
// synchronous flush) would blow past. The control-path probe remains the honest
// "does the rest of the app degrade?" signal in all phases.
//
// PHASE D UPDATE: classify + fold + sample now run on the stream-sharded worker
// pool, not the main thread, so the main event loop stays calm regardless of the
// per-line classification cost. That is why Phase A2 can double the offered rate
// (~20k lines/s) and still sit within the Phase A bound (~8-10ms p95 measured),
// and why the burst regime's main-loop p95 is comfortably inside its bound even
// while shedding a full buffer - the buffer's lines are classified OFF-thread.
// The bounds are kept generous for 2-core-CI-runner headroom, not because either
// regime is janky; a regression that moved per-line work back onto the main
// thread (or held the DB pool) would still blow past them.
