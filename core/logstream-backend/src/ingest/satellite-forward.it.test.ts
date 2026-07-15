/**
 * Integration test (real Postgres) for the LOGSTREAM satellite-forward path end
 * to end: a batch a satellite forwarded over the WS channel, serialized with the
 * SAME shared wire shaping the agent uses ({@link toWireLogLine}) and
 * JSON-round-tripped to simulate the channel, is fed to the REAL
 * `createLogstreamSatelliteCapabilityHandler`, which verifies the `ckls_` token
 * against the REAL token store, re-clamps timestamps, and feeds the REAL ingest
 * pipeline -> flush -> storage. We then read the severity buckets back to prove
 * the forwarded line actually LANDED and is queryable (the metricstream scrape
 * path has the analogous "lands in buckets a collector reads" IT; this is its
 * logstream counterpart).
 *
 * Requires CHECKSTACK_IT=1 and a reachable dev Postgres (skipped otherwise).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import {
  withTestDb,
  isIntegrationEnabled,
  createMockLogger,
  createMockSignalService,
  type TestDb,
} from "@checkstack/test-utils-backend";
import type { CacheManager, CacheProvider } from "@checkstack/cache-api";
import type { InstanceRuntime, SafeDatabase } from "@checkstack/backend-api";
import {
  DEFAULT_LOG_STREAM_CONFIG,
  toWireLogLine,
  type IngestedLine,
  type LogStreamConfig,
  type SatelliteLogBatchItem,
} from "@checkstack/logstream-common";
import { generateToken } from "../token-crypto";
import * as schema from "../schema";
import { createStorage, sumSeverityBands } from "../storage";
import { readStreamActivity } from "../storage/activity";
import { createImportantEventRecorder } from "../events/recorder";
import { createDrainEngine } from "../drain/engine";
import { createPushTokenLookup } from "@checkstack/telemetry-backend";
import { createIngestTokenCache } from "../api/token-cache";
import { createIngestAuthenticator } from "./auth";
import { LOGSTREAM_PUSH_SOURCE_TYPE_ID } from "./push/source-type";
import { createStubPushVerifier } from "./push/stub-verifier";
import { createStreamConfigResolver } from "./stream-config";
import { createIngestPipeline, type IngestPipeline } from "./pipeline";
import { createInProcessFlushExecutor } from "./flush-executor";
import { createLogstreamSatelliteCapabilityHandler } from "./satellite-handler";
import type { SatelliteCapabilityHandler } from "@checkstack/satellite-backend";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");
const STREAM = "sat-forward-stream";
const STREAM2 = "sat-forward-stream-2";
const SATELLITE = "sat-eu-west";
const CREATED = new Date("2026-01-01T00:00:00.000Z");
// A fixed core clock: the handler re-clamps forwarded timestamps to it, so the
// stored bucket is deterministic and we can read a tight window around it.
const NOW = new Date("2026-03-01T12:00:00.000Z");

/** Minimal in-memory CacheManager (the token cache + config resolver need one). */
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

/** Build one normalized line as the agent's parsers would, at event time `ts`. */
function line({ body, ts }: { body: string; ts: Date }): IngestedLine {
  return {
    ts,
    observedAt: ts,
    severityNumber: 17,
    severityText: "ERROR",
    band: "error",
    body,
  };
}

/**
 * Serialize a batch item exactly as the agent does (Date -> ISO via
 * {@link toWireLogLine}) and JSON-round-trip it, so the handler receives the
 * literal wire shape that crosses the channel.
 */
function wireBatch(items: SatelliteLogBatchItem[]): unknown {
  return JSON.parse(JSON.stringify(items));
}

describe.skipIf(!isIntegrationEnabled())(
  "logstream satellite-forward (integration)",
  () => {
    let test: TestDb<typeof schema>;
    let db: SafeDatabase<typeof schema>;
    let pipeline: IngestPipeline;
    let handler: SatelliteCapabilityHandler;
    let tokenSecret: string;
    let tokenSecret2: string;

    beforeAll(async () => {
      test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
      db = test.db;

      const config: LogStreamConfig = DEFAULT_LOG_STREAM_CONFIG;
      await db.insert(schema.logStreams).values([
        {
          id: STREAM,
          name: "Satellite Forward IT",
          config,
          createdAt: CREATED,
          updatedAt: CREATED,
        },
        {
          id: STREAM2,
          name: "Satellite Forward IT 2",
          config,
          createdAt: CREATED,
          updatedAt: CREATED,
        },
      ]);

      // The push tokens are owned by the telemetry platform now; a stub
      // verifier plays the promoted `telemetry_sources` rows (one per stream).
      const token = generateToken({ streamId: STREAM });
      tokenSecret = token.secret;
      const token2 = generateToken({ streamId: STREAM2 });
      tokenSecret2 = token2.secret;
      const verifier = createStubPushVerifier({
        sources: [
          { sourceId: "sat-forward-src", streamId: STREAM, tokenHash: token.tokenHash },
          {
            sourceId: "sat-forward-src-2",
            streamId: STREAM2,
            tokenHash: token2.tokenHash,
          },
        ],
      });

      const logger = createMockLogger();
      const signalService = createMockSignalService();
      const cacheManager = createInMemoryCacheManager();
      const storage = createStorage({ db });
      const recorder = createImportantEventRecorder({ db, signalService, logger });
      const drain = createDrainEngine({
        storage,
        cacheManager,
        instanceRuntime: undefined as unknown as InstanceRuntime,
        logger,
      });
      const executor = createInProcessFlushExecutor({ drain, logger });
      pipeline = createIngestPipeline({
        db,
        storage,
        drain,
        executor,
        recorder,
        signalService,
        logger,
        onIngestFlush: () => {},
        now: () => NOW,
      });
      pipeline.start();

      const cache = createIngestTokenCache({ cacheManager });
      const auth = createIngestAuthenticator({
        lookup: createPushTokenLookup({
          verifier,
          sourceTypeId: LOGSTREAM_PUSH_SOURCE_TYPE_ID,
          signal: "logs",
        }),
        cache,
      });
      const configResolver = createStreamConfigResolver({ db, cache });
      handler = createLogstreamSatelliteCapabilityHandler({
        db,
        auth,
        configResolver,
        pipeline,
        logger,
        now: () => NOW,
      });
    });

    afterAll(async () => {
      pipeline?.stop();
      await test?.dispose();
    });

    it("lands a satellite-forwarded log line in storage, readable as a severity bucket", async () => {
      const payload = wireBatch([
        {
          streamToken: tokenSecret,
          lines: [
            toWireLogLine(
              line({ body: "database connection refused", ts: NOW }),
            ),
            toWireLogLine(line({ body: "retrying in 5s", ts: NOW })),
          ],
        },
      ]);

      const outcome = await handler.handleTelemetryBatch!({
        satelliteId: SATELLITE,
        payload,
      });
      expect(outcome.accepted).toBe(2);
      expect(outcome.rejected).toBe(0);

      // Flush the buffer through classify -> fold -> storage (the size trigger
      // may not have fired for two lines; drive it explicitly, twice, to cover
      // the drain's async hand-off exactly as the load-guard IT does).
      await pipeline.flushNow();
      await pipeline.flushNow();

      const totals = await sumSeverityBands({
        runner: db,
        streamId: STREAM,
        from: new Date(NOW.getTime() - 5 * 60_000),
        to: new Date(NOW.getTime() + 5 * 60_000),
        grain: "minute",
      });
      // Both forwarded lines landed in the `error` band for this stream.
      expect(totals.error).toBe(2);
    });

    it("rejects a batch whose token is unknown/revoked and lands nothing", async () => {
      const payload = wireBatch([
        {
          streamToken: "ckls_not_a_real_token",
          lines: [toWireLogLine(line({ body: "should not land", ts: NOW }))],
        },
      ]);

      const outcome = await handler.handleTelemetryBatch!({
        satelliteId: SATELLITE,
        payload,
      });
      // Terminal rejection: nothing accepted, and no new bucket for the stream
      // beyond the two lines from the first test.
      expect(outcome.accepted).toBe(0);
      await pipeline.flushNow();

      const totals = await sumSeverityBands({
        runner: db,
        streamId: STREAM,
        from: new Date(NOW.getTime() - 5 * 60_000),
        to: new Date(NOW.getTime() + 5 * 60_000),
        grain: "minute",
      });
      expect(totals.error).toBe(2);
    });

    it("attributes per-group in-transit drops to each stream's OWN activity row", async () => {
      // One forwarded batch reports DIFFERENT drop counts for two streams (its
      // line payload is empty - drop attribution is independent of the lines).
      // Each stream's droppedInTransitCount must reflect only ITS OWN loss - the
      // exact over-count SAT-C #6 fixes (the old code spread one count onto both).
      const outcome = await handler.handleTelemetryBatch!({
        satelliteId: SATELLITE,
        payload: wireBatch([]),
        droppedByGroup: { [tokenSecret]: 3, [tokenSecret2]: 11 },
      });
      expect(outcome.accepted).toBe(0);

      const [a1, a2] = await Promise.all([
        readStreamActivity({ runner: db, streamId: STREAM }),
        readStreamActivity({ runner: db, streamId: STREAM2 }),
      ]);
      // Stream 1 charged 3, stream 2 charged 11 - never 14 on either.
      expect(a1?.droppedInTransitCount).toBe(3);
      expect(a2?.droppedInTransitCount).toBe(11);
    });
  },
);
