/**
 * PATTERN-METRIC E2E CHAIN (integration): the full path a "Pattern Metric"
 * health check depends on, which no other test exercises end to end.
 *
 *   createPattern (a USER template with a numeric `<*>`)
 *     -> real ingest of raw lines through the pipeline (parse -> buffer ->
 *        flush -> Drain classify -> severity/pattern/variable folds -> storage)
 *     -> the occurrences land on the USER patternId in the pattern buckets,
 *        the numeric wildcard folds into the variable buckets, and
 *     -> the `pattern-metric` collector reads avg/min/max/sampleCount from them.
 *
 * Each stage is unit-tested in isolation elsewhere; this proves they compose -
 * a user pattern authored via the API is actually the id ingest classifies onto,
 * and the numbers the collector reports are the numbers that were logged.
 *
 * Uses the DEFAULT in-process flush executor (no worker pool): passing only
 * `drain` to {@link createIngestPipeline} builds it, so this test drives the same
 * classify+fold+store code the workers-disabled deployment runs, on the main
 * thread, deterministically.
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
import type { InstanceRuntime } from "@checkstack/backend-api";
import { DEFAULT_LOG_STREAM_CONFIG } from "@checkstack/logstream-common";
import * as schema from "../schema";
import { createStorage } from "../storage";
import { createImportantEventRecorder } from "../events/recorder";
import { createDrainEngine } from "../drain/engine";
import { createIngestPipeline } from "../ingest/pipeline";
import { parseNativeBody } from "@checkstack/logstream-common";
import { createPatternOperations, computeUserPatternId } from "./patterns";
import { loadStreamHandle, createDbReader } from "../health/reader";
import { PatternMetricCollector } from "../health/pattern-metric-collector";
import type { LogStreamHealthClient } from "../health/strategy";
import { and, eq, sql } from "drizzle-orm";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");
const STREAM = "pattern-metric-chain-stream";
const CREATED = new Date("2026-01-01T00:00:00.000Z");
// Ingest and collector clocks land in the SAME minute bucket (12:00): the flush
// buckets the lines at floor(INGEST_NOW) = 12:00:00; the collector window
// [11:55:00, 12:01:00) then covers that bucket.
const INGEST_NOW = new Date("2026-07-12T12:00:30.000Z");
const COLLECTOR_NOW = new Date("2026-07-12T12:00:45.000Z");
const TEMPLATE = "response time <*> ms";

describe.skipIf(!isIntegrationEnabled())(
  "logstream pattern-metric chain (integration)",
  () => {
    let test: TestDb<typeof schema>;

    beforeAll(async () => {
      test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
      await test.db.insert(schema.logStreams).values({
        id: STREAM,
        name: "Pattern Metric Chain IT",
        config: DEFAULT_LOG_STREAM_CONFIG,
        createdAt: CREATED,
        updatedAt: CREATED,
      });
    });
    afterAll(async () => {
      await test.dispose();
    });

    it("classifies ingest onto a user pattern and the collector reads its numeric variable", async () => {
      const { db } = test;
      const logger = createMockLogger();
      const storage = createStorage({ db });
      const drain = createDrainEngine({
        storage,
        cacheManager: undefined,
        instanceRuntime: undefined as unknown as InstanceRuntime,
        logger,
      });
      const recorder = createImportantEventRecorder({
        db,
        signalService: createMockSignalService(),
        logger,
      });
      const pipeline = createIngestPipeline({
        db,
        storage,
        drain,
        recorder,
        signalService: createMockSignalService(),
        logger,
        onIngestFlush: () => {},
        now: () => INGEST_NOW,
      });

      // 1) Author the user pattern via the real API handler (durable row).
      const ops = createPatternOperations({
        db,
        logger,
        findReferencingChecks: async () => [],
        now: () => INGEST_NOW,
      });
      const created = await ops.createPattern({ streamId: STREAM, template: TEMPLATE });
      const userId = computeUserPatternId({ streamId: STREAM, template: TEMPLATE });
      expect(created.id).toBe(userId);
      expect(created.origin).toBe("user");

      // In production the `patterns.changed` hook makes every pod install the
      // protected cluster via `upsertUserPattern`; drive that directly on this
      // pod's engine so classify pins the same id the API wrote.
      const { patternId } = drain.upsertUserPattern({ streamId: STREAM, template: TEMPLATE });
      expect(patternId).toBe(userId);

      // 2) Ingest raw lines carrying numeric values at the wildcard position.
      const values = [100, 200, 300];
      const ndjson = values
        .map((v) => JSON.stringify({ message: `response time ${v} ms` }))
        .join("\n");
      const { lines } = parseNativeBody({
        text: ndjson,
        ndjson: true,
        config: DEFAULT_LOG_STREAM_CONFIG,
        now: INGEST_NOW,
      });
      expect(lines).toHaveLength(3);
      const result = pipeline.ingest({
        streamId: STREAM,
        lines,
        config: DEFAULT_LOG_STREAM_CONFIG,
        now: INGEST_NOW,
      });
      expect(result.accepted).toBe(3);

      // Force the flush cycle (parse->classify->fold->store). Twice, mirroring
      // teardown: the first may return an already-inflight cycle.
      await pipeline.flushNow();
      await pipeline.flushNow();
      pipeline.stop();

      // 3) Occurrences landed on the USER patternId in the pattern buckets.
      const [patternTotal] = await db
        .select({ total: sql<string>`coalesce(sum(${schema.logPatternBuckets.count}), 0)` })
        .from(schema.logPatternBuckets)
        .where(
          and(
            eq(schema.logPatternBuckets.streamId, STREAM),
            eq(schema.logPatternBuckets.patternId, userId),
          ),
        );
      expect(Number(patternTotal?.total ?? 0)).toBe(3);

      // 4) The numeric wildcard folded into the variable buckets at varIndex 0.
      const variableRows = await db
        .select()
        .from(schema.logPatternVariableBuckets)
        .where(
          and(
            eq(schema.logPatternVariableBuckets.streamId, STREAM),
            eq(schema.logPatternVariableBuckets.patternId, userId),
            eq(schema.logPatternVariableBuckets.varIndex, 0),
          ),
        );
      const variableCount = variableRows.reduce((s, r) => s + Number(r.count), 0);
      const variableSum = variableRows.reduce((s, r) => s + Number(r.sum), 0);
      expect(variableCount).toBe(3);
      expect(variableSum).toBe(600);
      expect(Math.min(...variableRows.map((r) => Number(r.min)))).toBe(100);
      expect(Math.max(...variableRows.map((r) => Number(r.max)))).toBe(300);

      // 5) The pattern-metric collector reads avg/min/max/sampleCount from them.
      const handle = await loadStreamHandle({ db, streamId: STREAM });
      expect(handle).not.toBeNull();
      const reader = createDbReader({ db, storage, handle: handle! });
      const client: LogStreamHealthClient = {
        streamId: STREAM,
        reader,
        exec: () =>
          Promise.reject(new Error("pattern-metric uses the reader, not exec")),
      };
      const collector = new PatternMetricCollector(() => COLLECTOR_NOW);
      const { result: metric, error } = await collector.execute({
        config: { patternId: userId, variableIndex: 0, windowSeconds: 300 },
        client,
        pluginId: "logstream",
      });
      // A successful collection (no transport error), with the exact numbers.
      expect(error).toBeUndefined();
      expect(metric).toEqual({
        avgValue: 200,
        minValue: 100,
        maxValue: 300,
        sampleCount: 3,
      });
    });
  },
);
