/**
 * The "metric-scrape" capability handler (integration): drives the REAL handler
 * against real `metric_scrape_targets` / `metric_streams` rows.
 *
 * Covers the behaviours the design hinges on:
 * - `buildCapabilityConfig` returns only the enabled targets BOUND to the
 *   satellite, with `maxSeries` = the stream's seriesCap and the RESOLVED bearer
 *   plaintext (deliberate deviation - see the schema comment).
 * - `handleTelemetryBatch` authorizes by BINDING: a target bound to a different
 *   satellite (or unknown) is rejected and never fed to the sink; the batch's
 *   per-target `droppedByGroup` counts are recorded on each bound target's own
 *   stream activity row (and unbound targets' drops are not).
 * - `handleCapabilityStatus` mirrors per-target scrape health and fires a
 *   `scrape_failing` event exactly on the threshold crossing.
 * - end to end: a satellite-bound target's forwarded datapoints flow through the
 *   REAL sink -> flush -> buckets, and the metric-window collector reads them.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  withTestDb,
  isIntegrationEnabled,
  createMockLogger,
  createMockSignalService,
  type TestDb,
} from "@checkstack/test-utils-backend";
import {
  DEFAULT_METRIC_STREAM_CONFIG,
  type MetricStreamConfig,
  type RecordImportantEventInput,
  type WireDatapoint,
} from "@checkstack/metricstream-common";
import { IngestBuffer, createFlushLoop } from "@checkstack/ingest-utils";
import type {
  InternalSecretsService,
  SecretResolverService,
} from "@checkstack/secrets-backend";
import * as schema from "../schema";
import { createStorage } from "../storage";
import { createMetricFlusher } from "../ingest/flush";
import {
  createMetricSink,
  estimateDatapointBytes,
  type BufferedDatapoint,
} from "../ingest/sink";
import type { StreamConfigResolver } from "../ingest/stream-config";
import type { ImportantEventRecorder } from "../events/recorder";
import type { MetricIngestSink } from "../sources/extension-point";
import { createDbReader, loadStreamHandle } from "../health/reader";
import { MetricWindowCollector } from "../health/metric-window-collector";
import type { MetricStreamHealthClient } from "../health/strategy";
import { METRICSTREAM_SECRET_MARKER_PREFIX } from "../secrets/scrape-target-secret";
import { SCRAPE_FAILING_THRESHOLD } from "../sources/prometheus/reconciler";
import { createMetricScrapeCapabilityHandler } from "./scrape-capability";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");
const STREAM = "scrape-cap-it-stream";
const SAT_A = "satellite-a";
const SAT_B = "satellite-b";
const CREATED = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-06-01T12:00:00.000Z");
const RESOLVED_BEARER = "resolved-bearer-secret";

/** A recorder that just collects the events it is asked to record. */
function recordingRecorder() {
  const recorded: RecordImportantEventInput[] = [];
  const recorder: ImportantEventRecorder = {
    record: async (input) => {
      recorded.push(input);
      return { ...input, id: "x", detail: input.detail ?? null, createdAt: new Date() };
    },
  };
  return { recorder, recorded };
}

/** A sink that records each ingest call and accepts everything. */
function recordingSink() {
  const calls: { streamId: string; count: number }[] = [];
  const sink: MetricIngestSink = {
    ingest: ({ streamId, datapoints }) => {
      calls.push({ streamId, count: datapoints.length });
      return { accepted: datapoints.length, rejected: 0 };
    },
  };
  return { sink, calls };
}

/**
 * Bearer resolution stubs: a marker resolves to a fixed plaintext. `secretGetCalls`
 * records every internal-secret read so a test can assert the store is NOT touched
 * when a binding check rejects the request.
 */
const secretGetCalls: unknown[] = [];
const fakeInternalSecrets = {
  get: async (args: unknown) => {
    secretGetCalls.push(args);
    return RESOLVED_BEARER;
  },
  set: async () => {},
  delete: async () => {},
} as unknown as InternalSecretsService;
const fakeSecretResolver = {
  resolveForRun: async () => ({ env: {} }),
} as unknown as SecretResolverService;

function gauge(name: string, value: number): WireDatapoint {
  return { name, type: "gauge", labels: {}, value, ts: NOW.toISOString() };
}

function buildHandler(
  db: TestDb<typeof schema>["db"],
  sink: MetricIngestSink,
  recorder: ImportantEventRecorder,
) {
  return createMetricScrapeCapabilityHandler({
    db,
    sink,
    recorder,
    internalSecrets: fakeInternalSecrets,
    secretResolver: fakeSecretResolver,
    logger: createMockLogger(),
    now: () => NOW,
  });
}

describe.skipIf(!isIntegrationEnabled())(
  "metricstream metric-scrape capability handler (integration)",
  () => {
    let test: TestDb<typeof schema>;

    beforeAll(async () => {
      test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
    });
    afterAll(async () => {
      await test.dispose();
    });

    beforeEach(async () => {
      secretGetCalls.length = 0;
      const { db } = test;
      await db.delete(schema.metricMinuteBuckets);
      await db.delete(schema.metricSeries);
      await db.delete(schema.metricNames);
      await db.delete(schema.metricImportantEvents);
      await db.delete(schema.metricStreamActivity);
      await db.delete(schema.metricScrapeTargets);
      await db.delete(schema.metricStreams);
      await db.insert(schema.metricStreams).values({
        id: STREAM,
        name: "Scrape Cap IT",
        config: DEFAULT_METRIC_STREAM_CONFIG,
        createdAt: CREATED,
        updatedAt: CREATED,
      });
    });

    async function insertTarget(input: {
      id: string;
      satelliteId: string | null;
      enabled?: boolean;
      bearerTokenSecret?: string | null;
      consecutiveFailures?: number;
    }): Promise<void> {
      await test.db.insert(schema.metricScrapeTargets).values({
        id: input.id,
        streamId: STREAM,
        name: input.id,
        url: `https://example.com/${input.id}/metrics`,
        intervalSeconds: 30,
        timeoutMs: 10_000,
        bearerTokenSecret: input.bearerTokenSecret ?? null,
        satelliteId: input.satelliteId,
        enabled: input.enabled ?? true,
        consecutiveFailures: input.consecutiveFailures ?? 0,
      });
    }

    // ─── buildCapabilityConfig ────────────────────────────────────────────

    it("builds only the satellite's enabled targets, with maxSeries and hasBearer (never a secret)", async () => {
      await insertTarget({ id: "a-plain", satelliteId: SAT_A });
      await insertTarget({
        id: "a-bearer",
        satelliteId: SAT_A,
        bearerTokenSecret: `${METRICSTREAM_SECRET_MARKER_PREFIX}a-bearer`,
      });
      await insertTarget({ id: "a-disabled", satelliteId: SAT_A, enabled: false });
      await insertTarget({ id: "b-target", satelliteId: SAT_B });
      await insertTarget({ id: "core-target", satelliteId: null });

      const { sink } = recordingSink();
      const { recorder } = recordingRecorder();
      const handler = buildHandler(test.db, sink, recorder);

      const config = await handler.buildCapabilityConfig!({ satelliteId: SAT_A });
      const targets = (config as { targets: Record<string, unknown>[] }).targets;
      const byId = new Map(targets.map((t) => [t.id as string, t]));

      // Only SAT_A's enabled targets: not disabled, not SAT_B's, not core's.
      expect([...byId.keys()].toSorted()).toEqual(["a-bearer", "a-plain"]);
      // A plain target: hasBearer false, no secret field of any kind.
      expect(byId.get("a-plain")).toEqual({
        id: "a-plain",
        name: "a-plain",
        url: "https://example.com/a-plain/metrics",
        intervalSeconds: 30,
        timeoutMs: 10_000,
        maxSeries: DEFAULT_METRIC_STREAM_CONFIG.seriesCap,
        hasBearer: false,
      });
      // A bearer target: hasBearer true, and the PLAINTEXT never rides the config.
      expect(byId.get("a-bearer")!.hasBearer).toBe(true);
      expect(byId.get("a-bearer")).not.toHaveProperty("bearerToken");
      // buildCapabilityConfig must not resolve any secret (that is JIT-only now).
      expect(secretGetCalls).toHaveLength(0);
    });

    // ─── resolveSecret: JIT bearer, binding-authorized ────────────────────

    it("resolves a bound target's bearer JIT and omits it when none is set", async () => {
      await insertTarget({
        id: "a-bearer",
        satelliteId: SAT_A,
        bearerTokenSecret: `${METRICSTREAM_SECRET_MARKER_PREFIX}a-bearer`,
      });
      await insertTarget({ id: "a-plain", satelliteId: SAT_A });

      const { sink } = recordingSink();
      const { recorder } = recordingRecorder();
      const handler = buildHandler(test.db, sink, recorder);

      // Bound target WITH a bearer -> the resolved plaintext.
      const withBearer = await handler.resolveSecret!({
        satelliteId: SAT_A,
        payload: { targetId: "a-bearer" },
      });
      expect(withBearer).toEqual({ payload: { bearerToken: RESOLVED_BEARER } });

      // Bound target WITHOUT a bearer -> empty response (agent scrapes unauth'd).
      const noBearer = await handler.resolveSecret!({
        satelliteId: SAT_A,
        payload: { targetId: "a-plain" },
      });
      expect(noBearer).toEqual({ payload: {} });
    });

    it("refuses to resolve a bearer for a target bound to a different satellite (never touches the store)", async () => {
      await insertTarget({
        id: "b-target",
        satelliteId: SAT_B,
        bearerTokenSecret: `${METRICSTREAM_SECRET_MARKER_PREFIX}b-target`,
      });
      const { sink } = recordingSink();
      const { recorder } = recordingRecorder();
      const handler = buildHandler(test.db, sink, recorder);

      const mismatched = await handler.resolveSecret!({
        satelliteId: SAT_A, // not the bound satellite
        payload: { targetId: "b-target" },
      });
      expect(mismatched.payload).toBeUndefined();
      expect(mismatched.error).toBeTruthy();

      const unknown = await handler.resolveSecret!({
        satelliteId: SAT_A,
        payload: { targetId: "ghost" },
      });
      expect(unknown.payload).toBeUndefined();
      expect(unknown.error).toBeTruthy();

      // Binding is the authorization: the secret store was never read.
      expect(secretGetCalls).toHaveLength(0);
    });

    it("returns an error for a malformed secret request", async () => {
      const { sink } = recordingSink();
      const { recorder } = recordingRecorder();
      const handler = buildHandler(test.db, sink, recorder);
      const result = await handler.resolveSecret!({
        satelliteId: SAT_A,
        payload: { not: "a targetId" },
      });
      expect(result.payload).toBeUndefined();
      expect(result.error).toBeTruthy();
    });

    it("returns an empty target set for a satellite with no bound targets", async () => {
      await insertTarget({ id: "core-target", satelliteId: null });
      const { sink } = recordingSink();
      const { recorder } = recordingRecorder();
      const handler = buildHandler(test.db, sink, recorder);
      const config = await handler.buildCapabilityConfig!({ satelliteId: SAT_A });
      expect(config).toEqual({ targets: [] });
    });

    // ─── handleTelemetryBatch: binding is the authorization ───────────────

    it("feeds datapoints for a bound target, rejects mismatched/unknown, and records in-transit drops", async () => {
      await insertTarget({ id: "a-target", satelliteId: SAT_A });
      await insertTarget({ id: "b-target", satelliteId: SAT_B });

      const { sink, calls } = recordingSink();
      const { recorder } = recordingRecorder();
      const handler = buildHandler(test.db, sink, recorder);

      const outcome = await handler.handleTelemetryBatch!({
        satelliteId: SAT_A,
        // Per-target drops: a-target is bound to SAT_A (charged), b-target is
        // bound to SAT_B (NOT this satellite -> not attributed).
        droppedByGroup: { "a-target": 4, "b-target": 9 },
        payload: [
          { targetId: "a-target", datapoints: [gauge("cpu", 1), gauge("cpu", 2)] },
          // Bound to SAT_B -> SAT_A may not report for it.
          { targetId: "b-target", datapoints: [gauge("cpu", 3)] },
          // Unknown target.
          { targetId: "ghost", datapoints: [gauge("cpu", 4)] },
        ],
      });

      // 2 accepted (a-target), 2 rejected (b-target + ghost).
      expect(outcome).toEqual({ accepted: 2, rejected: 2 });
      expect(calls).toEqual([{ streamId: STREAM, count: 2 }]);

      // Only a-target's drops (4) are recorded on ITS stream; b-target's 9 are
      // NOT attributed (bound to a different satellite).
      const [activity] = await test.db
        .select()
        .from(schema.metricStreamActivity)
        .where(eq(schema.metricStreamActivity.streamId, STREAM));
      expect(Number(activity!.droppedInTransitCount)).toBe(4);
    });

    it("drops a malformed metric-scrape batch non-retryably", async () => {
      const { sink, calls } = recordingSink();
      const { recorder } = recordingRecorder();
      const handler = buildHandler(test.db, sink, recorder);
      const outcome = await handler.handleTelemetryBatch!({
        satelliteId: SAT_A,
        payload: { not: "an array" },
      });
      expect(outcome).toEqual({ accepted: 0, rejected: 0, retryable: false });
      expect(calls).toEqual([]);
    });

    // ─── handleCapabilityStatus ───────────────────────────────────────────

    it("mirrors scrape health and fires scrape_failing exactly on the threshold crossing", async () => {
      await insertTarget({ id: "a-target", satelliteId: SAT_A });
      const { sink } = recordingSink();
      const { recorder, recorded } = recordingRecorder();
      const handler = buildHandler(test.db, sink, recorder);

      // Report a failure crossing the threshold in one jump (0 -> THRESHOLD).
      await handler.handleCapabilityStatus!({
        satelliteId: SAT_A,
        payload: [
          {
            targetId: "a-target",
            lastScrapeAt: NOW.toISOString(),
            lastError: "connection refused",
            consecutiveFailures: SCRAPE_FAILING_THRESHOLD,
          },
        ],
      });

      const [row] = await test.db
        .select()
        .from(schema.metricScrapeTargets)
        .where(eq(schema.metricScrapeTargets.id, "a-target"));
      expect(row!.lastError).toBe("connection refused");
      expect(row!.consecutiveFailures).toBe(SCRAPE_FAILING_THRESHOLD);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]!.type).toBe("scrape_failing");

      // A further failure past the threshold does NOT re-fire (one per episode).
      await handler.handleCapabilityStatus!({
        satelliteId: SAT_A,
        payload: [
          {
            targetId: "a-target",
            lastScrapeAt: NOW.toISOString(),
            lastError: "still down",
            consecutiveFailures: SCRAPE_FAILING_THRESHOLD + 1,
          },
        ],
      });
      expect(recorded).toHaveLength(1);

      // Recovery clears the error and count.
      await handler.handleCapabilityStatus!({
        satelliteId: SAT_A,
        payload: [
          {
            targetId: "a-target",
            lastScrapeAt: NOW.toISOString(),
            lastError: null,
            consecutiveFailures: 0,
          },
        ],
      });
      const [recovered] = await test.db
        .select()
        .from(schema.metricScrapeTargets)
        .where(eq(schema.metricScrapeTargets.id, "a-target"));
      expect(recovered!.lastError).toBeNull();
      expect(recovered!.consecutiveFailures).toBe(0);
    });

    it("ignores a status update for a target bound to a different satellite", async () => {
      await insertTarget({
        id: "b-target",
        satelliteId: SAT_B,
        consecutiveFailures: 0,
      });
      const { sink } = recordingSink();
      const { recorder, recorded } = recordingRecorder();
      const handler = buildHandler(test.db, sink, recorder);

      await handler.handleCapabilityStatus!({
        satelliteId: SAT_A, // not the bound satellite
        payload: [
          {
            targetId: "b-target",
            lastScrapeAt: NOW.toISOString(),
            lastError: "spoofed",
            consecutiveFailures: 9,
          },
        ],
      });

      const [row] = await test.db
        .select()
        .from(schema.metricScrapeTargets)
        .where(eq(schema.metricScrapeTargets.id, "b-target"));
      // Untouched: the binding mismatch was rejected.
      expect(row!.lastError).toBeNull();
      expect(row!.consecutiveFailures).toBe(0);
      expect(recorded).toHaveLength(0);
    });

    // ─── end to end via the REAL sink -> flush -> buckets -> collector ────

    it("lands forwarded scrape datapoints in buckets the metric-window collector reads", async () => {
      await insertTarget({ id: "a-target", satelliteId: SAT_A });

      const { db } = test;
      const config: MetricStreamConfig = DEFAULT_METRIC_STREAM_CONFIG;
      const configResolver: StreamConfigResolver = { resolve: async () => config };
      const buffer = new IngestBuffer<BufferedDatapoint>({
        estimateBytes: estimateDatapointBytes,
      });
      const flusher = createMetricFlusher({
        db,
        storage: createStorage({ db }),
        recorder: recordingRecorder().recorder,
        signalService: createMockSignalService(),
        configResolver,
        logger: createMockLogger(),
        flushIntervalMs: 500,
        now: () => NOW,
      });
      const flushLoop = createFlushLoop({
        intervalMs: 500,
        runCycle: async () => {
          const drained = buffer.drain();
          if (drained.size === 0) return;
          await flusher.flushDrained(drained);
        },
      });
      const sink = createMetricSink({ buffer, flushLoop, flushThreshold: 5000 });

      const handler = buildHandler(db, sink, recordingRecorder().recorder);

      // buildCapabilityConfig surfaces the target, then a forwarded batch for it
      // flows through the real sink.
      const built = await handler.buildCapabilityConfig!({ satelliteId: SAT_A });
      expect((built as { targets: unknown[] }).targets).toHaveLength(1);

      const outcome = await handler.handleTelemetryBatch!({
        satelliteId: SAT_A,
        payload: [
          {
            targetId: "a-target",
            datapoints: [gauge("cpu_seconds", 10), gauge("cpu_seconds", 12)],
          },
        ],
      });
      expect(outcome.accepted).toBe(2);
      await flushLoop.flushNow();
      flushLoop.stop();

      // The collector reads the landed datapoints back.
      const handle = await loadStreamHandle({ db, streamId: STREAM });
      if (!handle) throw new Error("stream not found");
      const readerNow = new Date(NOW.getTime() + 30_000);
      const reader = createDbReader({
        db,
        storage: createStorage({ db }),
        handle,
        now: () => readerNow,
      });
      const client: MetricStreamHealthClient = {
        streamId: STREAM,
        reader,
        exec: () => Promise.reject(new Error("no exec")),
      };
      const collector = new MetricWindowCollector(() => readerNow);
      const { result, error } = await collector.execute({
        config: { metricName: "cpu_seconds", labelFilters: [], windowSeconds: 300 },
        client,
        pluginId: "metricstream",
      });

      expect(error).toBeUndefined();
      expect(result!.sampleCount).toBe(2);
      expect(result!.seriesCount).toBe(1);
      expect(result!.lastValue).toBe(12);
      expect(result!.maxValue).toBe(12);
      expect(result!.minValue).toBe(10);
    });
  },
);
