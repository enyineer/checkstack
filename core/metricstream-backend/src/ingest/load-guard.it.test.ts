/**
 * LOAD GUARD (integration): high-volume metric ingest must NOT degrade the rest
 * of the application's responsiveness.
 *
 * A responsiveness regression guard, not a throughput benchmark. It drives the
 * REAL end-to-end push path against REAL Postgres - the OTLP-JSON and native
 * HTTP handlers (auth -> parse/normalize -> admit -> sink buffer) plus the flush
 * loop's fold (drain -> cardinality/name/bucket writes in ONE transaction) - and
 * MEASURES that the shared process and the shared DB pool stay responsive under
 * load. It FAILS if ingestion starves the event loop or the pool, drops accepted
 * data, or fails to shed overload.
 *
 * THREE PHASES:
 *   Phase A - RESPONSIVENESS under sustained, absorbable high load (~25k
 *   datapoints/s offered, well above the 20k floor), fully accepted. The
 *   event-loop and probe bounds are meaningful and stable here.
 *   Phase B - BACKPRESSURE under an overload burst (offer far above the drain
 *   rate): the sink's bounded buffer sheds to 429, every offered datapoint is
 *   accounted for, RSS stays bounded, and the loop stays responsive (the fold
 *   yields every 2000 datapoints).
 *   Plus a SCRAPE pass: one Prometheus scrape against an in-test fixture server,
 *   proving the pull executor's real fetch->parse->sink path.
 *
 * LANE: standard integration lane (`CHECKSTACK_IT=1 bun test it.test`, real
 * Postgres). Own throwaway schema + stream, so it never contends with other IT
 * files. Phase A window defaults to ~8s; override with `CHECKSTACK_IT_LOAD_MS`.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { eq, inArray, sql } from "drizzle-orm";
import {
  withTestDb,
  isIntegrationEnabled,
  createMockLogger,
  createMockSignalService,
  type TestDb,
} from "@checkstack/test-utils-backend";
import type { CacheManager, CacheProvider } from "@checkstack/cache-api";
import {
  createSourceTokenKit,
  createIngestAuthenticator,
  createIngestTokenCache,
  IngestBuffer,
  createFlushLoop,
  RateLimiter,
} from "@checkstack/ingest-utils";
import {
  DEFAULT_METRIC_STREAM_CONFIG,
  METRICSTREAM_TOKEN_PREFIX,
  type MetricStreamConfig,
} from "@checkstack/metricstream-common";
import * as schema from "../schema";
import { metricMinuteBuckets, metricSeries, metricStreams } from "../schema";
import { createStorage } from "../storage";
import { readStreamActivity } from "../storage";
import { createImportantEventRecorder } from "../events/recorder";
import { createStreamConfigResolver } from "./stream-config";
import { lookupTokenByHash } from "./token-lookup";
import { createMetricFlusher } from "./flush";
import { createMetricSink, estimateDatapointBytes, type BufferedDatapoint } from "./sink";
import { createOtlpMetricsHandler } from "../sources/otlp/endpoint";
import { createNativeMetricsHandler } from "../sources/native/endpoint";
import { executePrometheusScrape } from "../sources/prometheus/scrape";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");
const STREAM = "load-guard-metric-stream";
const CREATED = new Date("2026-01-01T00:00:00.000Z");
const OTLP_URL = "http://localhost/api/metricstream/v1/metrics";
const NATIVE_URL = "http://localhost/api/metricstream/ingest";

// Load shape.
const PRODUCERS = 8; // 4 native + 4 OTLP-JSON
const BATCH = 200; // datapoints per POST
const WARMUP_MS = 2000;
const MEASURE_MS = Number(process.env.CHECKSTACK_IT_LOAD_MS ?? 8000);
const BURST_MS = 3000;
const PROBE_INTERVAL_MS = 200;

// Phase A pacing: 8 producers * 200 / 0.06s ~= 26.7k datapoints/s offered
// (offered counts before the handler, so it holds regardless of absorption).
const SUSTAIN_PACING_MS = 60;
const SUSTAIN_MIN_PER_SEC = 20_000; // the requirement's floor

// Bounds (p95, with headroom for a loaded 2-core CI runner). A real regression
// (per-datapoint sync DB work, sync gzip/hash on the request path, a fold that
// holds the loop) blows well past them.
const EVENT_LOOP_P95_MAX_MS = 150;
const EVENT_LOOP_P95_MAX_BURST_MS = 200;
const PROBE_P95_MAX_MS = 750;
const RSS_GROWTH_MAX_BYTES = 300 * 1024 * 1024;

// Bounded, realistic series space so cardinality converges (finite series set).
const METRIC_NAMES = ["cpu_seconds", "mem_bytes", "http_requests", "queue_depth", "latency_ms"];
const HOSTS = Array.from({ length: 20 }, (_, i) => `host-${i}`);

describe.skipIf(!isIntegrationEnabled())(
  "metricstream ingest load guard (integration)",
  () => {
    let test: TestDb<typeof schema>;
    let otlpHandler: (request: Request) => Promise<Response>;
    let nativeHandler: (request: Request) => Promise<Response>;
    let sink: ReturnType<typeof createMetricSink>;
    let flushLoop: ReturnType<typeof createFlushLoop>;
    let tokenSecret: string;

    beforeAll(async () => {
      test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
      const { db } = test;

      // Soft limiter DISABLED (0) so the BUFFER (not the limiter) is the
      // backpressure under test - the path that must shed to 429 and bound
      // memory. Everything else is the shipped default policy.
      const config: MetricStreamConfig = {
        ...DEFAULT_METRIC_STREAM_CONFIG,
        softDatapointsPerMinute: 0,
        maxDatapointsPerRequest: 1_000_000,
      };
      await db.insert(metricStreams).values({
        id: STREAM,
        name: "Load Guard IT",
        description: null,
        config,
        createdAt: CREATED,
        updatedAt: CREATED,
      });

      const tokenKit = createSourceTokenKit({ prefix: METRICSTREAM_TOKEN_PREFIX });
      const token = tokenKit.generateToken({ resourceId: STREAM });
      tokenSecret = token.secret;
      await db.insert(schema.metricStreamTokens).values({
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
      const configResolver = createStreamConfigResolver({
        db,
        cache: createIngestTokenCache({ cacheManager, pluginId: "metricstream" }),
      });

      const buffer = new IngestBuffer<BufferedDatapoint>({ estimateBytes: estimateDatapointBytes });
      const flusher = createMetricFlusher({
        db,
        storage,
        recorder,
        signalService,
        configResolver,
        logger,
        flushIntervalMs: 500,
      });
      flushLoop = createFlushLoop({
        intervalMs: 500,
        runCycle: async () => {
          const drained = buffer.drain();
          if (drained.size === 0) return;
          await flusher.flushDrained(drained);
        },
      });
      flushLoop.start();
      sink = createMetricSink({ buffer, flushLoop, flushThreshold: 5000 });

      const auth = createIngestAuthenticator({
        lookup: (tokenHash) => lookupTokenByHash({ db, tokenHash }),
        cache: createIngestTokenCache({ cacheManager, pluginId: "metricstream" }),
        hashToken: tokenKit.hashToken,
      });
      const rateLimiter = new RateLimiter();
      otlpHandler = createOtlpMetricsHandler({ auth, configResolver, sink, logger, rateLimiter });
      nativeHandler = createNativeMetricsHandler({ auth, configResolver, sink, rateLimiter });
    });

    afterAll(async () => {
      flushLoop?.stop();
      await test?.dispose();
    });

    it("stays responsive under sustained high metric ingest, sheds overload, loses no accepted data", async () => {
      const authorization = `Bearer ${tokenSecret}`;

      let running = true;
      const pace = { ms: SUSTAIN_PACING_MS };
      const offered = { dp: 0 };
      const accepted = { dp: 0 };
      const rejected = { dp: 0 };
      let measuringProbe = false;
      const probeLatencies: number[] = [];
      let probeFailures = 0;
      let probeCount = 0;

      // Precompute a pool of ready request bodies so the generator's own JSON
      // allocation does not contaminate the event-loop measurement.
      const POOL = 64;
      const nativePool = Array.from({ length: POOL }, (_, k) => buildNativeBatch(k));
      const otlpPool = Array.from({ length: POOL }, (_, k) => buildOtlpJsonBatch(k));

      async function accountResponse(res: Response, kind: "native" | "otlp"): Promise<void> {
        if (res.status === 202) {
          const body = (await res.json()) as { accepted: number; rejected: number };
          accepted.dp += body.accepted;
          rejected.dp += body.rejected;
        } else if (res.status === 200) {
          // OTLP: accepted = batch - rejectedDataPoints (partialSuccess).
          const body = (await res.json()) as { partialSuccess?: { rejectedDataPoints?: number } };
          const rej = body.partialSuccess?.rejectedDataPoints ?? 0;
          accepted.dp += BATCH - rej;
          rejected.dp += rej;
        } else if (res.status === 429) {
          rejected.dp += BATCH;
        } else {
          void kind; // unexpected: leave unaccounted so the sum assertion trips
        }
      }

      async function produceNative(id: number): Promise<void> {
        let seq = 0;
        while (running) {
          const body = nativePool[(id * 13 + seq++) % POOL];
          offered.dp += BATCH;
          try {
            const res = await nativeHandler(
              new Request(NATIVE_URL, {
                method: "POST",
                headers: { authorization, "content-type": "application/x-ndjson" },
                body,
              }),
            );
            await accountResponse(res, "native");
          } catch {
            /* a thrown handler is a crash-under-load failure; the sum assertion trips */
          }
          await sleep(pace.ms);
        }
      }

      async function produceOtlp(id: number): Promise<void> {
        let seq = 0;
        while (running) {
          const body = otlpPool[(id * 17 + seq++) % POOL];
          offered.dp += BATCH;
          try {
            const res = await otlpHandler(
              new Request(OTLP_URL, {
                method: "POST",
                headers: { authorization, "content-type": "application/json" },
                body,
              }),
            );
            await accountResponse(res, "otlp");
          } catch {
            /* crash-under-load; sum assertion trips */
          }
          await sleep(pace.ms);
        }
      }

      async function probe(): Promise<void> {
        while (running) {
          const startedAt = performance.now();
          try {
            await getStream(test.db, STREAM);
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

      const producers = [
        ...Array.from({ length: PRODUCERS / 2 }, (_, i) => produceNative(i)),
        ...Array.from({ length: PRODUCERS / 2 }, (_, i) => produceOtlp(i)),
      ];
      const probing = probe();

      await sleep(WARMUP_MS);

      // ---- Phase A: sustained absorbable load ----
      loopDelay.reset();
      probeLatencies.length = 0;
      probeFailures = 0;
      probeCount = 0;
      measuringProbe = true;
      const offeredAtStart = offered.dp;
      const phaseAStart = performance.now();
      await sleep(MEASURE_MS);
      const phaseAMs = performance.now() - phaseAStart;
      const eventLoopP95Ms = loopDelay.percentile(95) / 1e6;
      const eventLoopMaxMs = loopDelay.max / 1e6;
      const offeredPerSec = Math.round((offered.dp - offeredAtStart) / (phaseAMs / 1000));

      // ---- Phase B: overload burst ----
      const rssBeforeBurst = process.memoryUsage().rss;
      const rejectedBeforeBurst = rejected.dp;
      loopDelay.reset();
      pace.ms = 0;
      await sleep(BURST_MS);
      const rssBurstPeak = process.memoryUsage().rss;
      const eventLoopP95BurstMs = loopDelay.percentile(95) / 1e6;
      const burstShed = rejected.dp - rejectedBeforeBurst;
      const rssGrowthBytes = rssBurstPeak - rssBeforeBurst;

      running = false;
      await Promise.all([...producers, probing]);
      loopDelay.disable();

      // Drain the buffer tail (three flushes: the first may return an already
      // in-flight cycle; the rest guarantee the remainder lands).
      await flushLoop.flushNow();
      await flushLoop.flushNow();
      await flushLoop.flushNow();

      const probeP95Ms = percentile(probeLatencies, 95);
      const persisted = await sumBucketCounts(test.db, STREAM);
      const activity = await readStreamActivity({ runner: test.db, streamId: STREAM });

      console.log(
        "[metric-load-guard] " +
          JSON.stringify({
            offeredPerSec,
            eventLoopP95Ms: round2(eventLoopP95Ms),
            eventLoopMaxMs: round2(eventLoopMaxMs),
            eventLoopP95BurstMs: round2(eventLoopP95BurstMs),
            probeCount,
            probeP95Ms: round2(probeP95Ms),
            probeFailures,
            offered: offered.dp,
            accepted: accepted.dp,
            rejected: rejected.dp,
            burstShed,
            rssGrowthMB: round2(rssGrowthBytes / (1024 * 1024)),
            persisted,
          }),
      );

      // ---- Phase A assertions ----
      expect(offeredPerSec).toBeGreaterThanOrEqual(SUSTAIN_MIN_PER_SEC);
      expect(eventLoopP95Ms).toBeLessThanOrEqual(EVENT_LOOP_P95_MAX_MS);

      // ---- Shared-pool control path stayed responsive ----
      expect(probeCount).toBeGreaterThan(0);
      expect(probeFailures).toBe(0);
      expect(probeP95Ms).toBeLessThanOrEqual(PROBE_P95_MAX_MS);

      // ---- Phase B: overflow shed, accounted, bounded RSS + loop ----
      expect(burstShed).toBeGreaterThan(0);
      expect(eventLoopP95BurstMs).toBeLessThanOrEqual(EVENT_LOOP_P95_MAX_BURST_MS);
      expect(accepted.dp + rejected.dp).toBe(offered.dp);
      expect(rssGrowthBytes).toBeLessThanOrEqual(RSS_GROWTH_MAX_BYTES);

      // ---- Integrity: persisted bucket counts == accepted MINUS cardinality
      // drops. Datapoints of series refused by the cardinality cap are ACCEPTED
      // into the buffer (200/202) but never fold into buckets, so persisted lags
      // accepted by exactly the cap-dropped count. The bounded series space here
      // stays under the default cap (droppedDatapoints == 0), but subtracting it
      // keeps the invariant exact under cap pressure instead of failing. ----
      const droppedDatapoints = activity?.droppedDatapointsCount ?? 0;
      expect(accepted.dp).toBeGreaterThan(0);
      expect(persisted).toBe(accepted.dp - droppedDatapoints);
      expect(activity).not.toBeNull();
      expect(activity?.lastReceivedAt).toBeInstanceOf(Date);
    }, WARMUP_MS + MEASURE_MS + BURST_MS + 60_000);

    it("runs one real Prometheus scrape against a fixture server through the pull executor", async () => {
      const scrapeStream = "load-guard-scrape-stream";
      await test.db.insert(metricStreams).values({
        id: scrapeStream,
        name: "Scrape IT",
        description: null,
        config: DEFAULT_METRIC_STREAM_CONFIG,
        createdAt: CREATED,
        updatedAt: CREATED,
      });

      const server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(
            [
              "# TYPE http_requests_total counter",
              'http_requests_total{method="get"} 1200',
              'http_requests_total{method="post"} 42',
              "# TYPE inflight gauge",
              "inflight 7",
            ].join("\n"),
            { headers: { "content-type": "text/plain" } },
          );
        },
      });

      try {
        const result = await executePrometheusScrape({
          target: {
            id: "scrape-target",
            streamId: scrapeStream,
            name: "fixture",
            url: `http://localhost:${server.port}/metrics`,
            timeoutMs: 5000,
            maxSeries: 1000,
          },
          sink,
          logger: createMockLogger(),
        });
        expect(result.seriesCount).toBe(3);
        expect(result.datapointCount).toBe(3);
      } finally {
        server.stop(true);
      }

      await flushLoop.flushNow();
      await flushLoop.flushNow();
      const persisted = await sumBucketCounts(test.db, scrapeStream);
      expect(persisted).toBe(3);
    }, 30_000);
  },
);

// ===========================================================================
// Helpers
// ===========================================================================

/** A native NDJSON batch of BATCH datapoints over the bounded series space. */
function buildNativeBatch(seq: number): string {
  const lines = Array.from({ length: BATCH }, (_, i) => {
    const name = METRIC_NAMES[(seq + i) % METRIC_NAMES.length];
    const host = HOSTS[(seq * 7 + i) % HOSTS.length];
    const isCounter = name === "http_requests" || name === "cpu_seconds";
    return JSON.stringify({
      name,
      type: isCounter ? "counter" : "gauge",
      value: (seq * 131 + i) % 1000,
      labels: { host },
    });
  });
  return lines.join("\n");
}

/** An OTLP/JSON ExportMetricsServiceRequest of BATCH gauge datapoints. */
function buildOtlpJsonBatch(seq: number): string {
  const dataPoints = Array.from({ length: BATCH }, (_, i) => ({
    attributes: [{ key: "host", value: { stringValue: HOSTS[(seq + i) % HOSTS.length] } }],
    timeUnixNano: "0",
    asDouble: (seq + i) % 500,
  }));
  // One metric with BATCH datapoints keeps the offered->accepted count exact.
  return JSON.stringify({
    resourceMetrics: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: "loadgen" } }] },
        scopeMetrics: [
          { metrics: [{ name: `otlp_gauge_${seq % METRIC_NAMES.length}`, gauge: { dataPoints } }] },
        ],
      },
    ],
  });
}

/** A representative non-ingest read on the same pool (the "rest of the app" proxy). */
async function getStream(db: TestDb<typeof schema>["db"], streamId: string): Promise<unknown> {
  const [row] = await db
    .select({ id: metricStreams.id, name: metricStreams.name })
    .from(metricStreams)
    .where(eq(metricStreams.id, streamId))
    .limit(1);
  return row;
}

/** Sum every minute bucket's count across a stream's series (== persisted datapoints). */
async function sumBucketCounts(
  db: TestDb<typeof schema>["db"],
  streamId: string,
): Promise<number> {
  const seriesRows = await db
    .select({ id: metricSeries.id })
    .from(metricSeries)
    .where(eq(metricSeries.streamId, streamId));
  const ids = seriesRows.map((r) => r.id);
  if (ids.length === 0) return 0;
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${metricMinuteBuckets.count}), 0)` })
    .from(metricMinuteBuckets)
    .where(inArray(metricMinuteBuckets.seriesId, ids));
  return Number(row?.total ?? 0);
}

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

/** A minimal in-process CacheManager backing the ingest token + config caches. */
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
