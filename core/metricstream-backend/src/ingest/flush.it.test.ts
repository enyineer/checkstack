/**
 * Series-cap important-event emission + dedup (integration): drives the REAL
 * flush path (`createMetricFlusher.flushDrained` -> fold -> `writeFlushPlan` in a
 * real transaction) against real Postgres, with a MOCK recorder, and asserts a
 * `series_cap` event fires once when the cardinality cap drops series and is
 * DEDUPED within the 10-minute window (one event per episode, not per flush).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import path from "node:path";
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
  type NormalizedDatapoint,
  type RecordImportantEventInput,
} from "@checkstack/metricstream-common";
import * as schema from "../schema";
import { createStorage } from "../storage";
import type { ImportantEventRecorder } from "../events/recorder";
import type { StreamConfigResolver } from "./stream-config";
import { createMetricFlusher, SERIES_CAP_EVENT_DEDUP_MS } from "./flush";
import type { BufferedDatapoint } from "./sink";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");
const STREAM = "flush-cap-it-stream";
const CREATED = new Date("2026-01-01T00:00:00.000Z");

/** A batch of `count` brand-new gauge series (unique labels), all one metric. */
function newSeriesBatch(count: number, salt: string, ts: Date): BufferedDatapoint[] {
  return Array.from({ length: count }, (_, i) => {
    const datapoint: NormalizedDatapoint = {
      name: "widgets",
      type: "gauge",
      labels: { host: `${salt}-${i}` },
      value: i,
      ts,
    };
    return { streamId: STREAM, datapoint };
  });
}

describe.skipIf(!isIntegrationEnabled())(
  "metricstream flush series-cap events (integration)",
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
      await db.delete(schema.metricMinuteBuckets);
      await db.delete(schema.metricSeries);
      await db.delete(schema.metricNames);
      await db.delete(schema.metricImportantEvents);
      await db.delete(schema.metricStreamActivity);
      await db.delete(schema.metricStreams);
      await db.insert(schema.metricStreams).values({
        id: STREAM,
        name: "Flush Cap IT",
        config: DEFAULT_METRIC_STREAM_CONFIG,
        createdAt: CREATED,
        updatedAt: CREATED,
      });
    });

    it("emits one series_cap event and dedups within the 10-minute window", async () => {
      const { db } = test;
      const recorded: RecordImportantEventInput[] = [];
      const recorder: ImportantEventRecorder = {
        record: async (input) => {
          recorded.push(input);
          return { ...input, id: "x", detail: input.detail ?? null, createdAt: new Date() };
        },
      };
      // Cap of 1: the first new series is admitted, the rest are dropped.
      const config: MetricStreamConfig = { ...DEFAULT_METRIC_STREAM_CONFIG, seriesCap: 1 };
      const configResolver: StreamConfigResolver = { resolve: async () => config };

      let clock = new Date("2026-06-01T12:00:00.000Z");
      const flusher = createMetricFlusher({
        db,
        storage: createStorage({ db }),
        recorder,
        signalService: createMockSignalService(),
        configResolver,
        logger: createMockLogger(),
        flushIntervalMs: 500,
        now: () => clock,
      });

      // Flush 1: 4 new series, cap 1 -> 3 dropped -> ONE event.
      await flusher.flushDrained(
        new Map([[STREAM, newSeriesBatch(4, "a", clock)]]),
      );
      expect(recorded).toHaveLength(1);
      expect(recorded[0]!.type).toBe("series_cap");

      // Flush 2, five minutes later (< dedup window): more drops, NO new event.
      clock = new Date(clock.getTime() + 5 * 60_000);
      await flusher.flushDrained(
        new Map([[STREAM, newSeriesBatch(4, "b", clock)]]),
      );
      expect(recorded).toHaveLength(1);

      // Flush 3, past the dedup window: a fresh episode -> a second event.
      clock = new Date(clock.getTime() + SERIES_CAP_EVENT_DEDUP_MS + 60_000);
      await flusher.flushDrained(
        new Map([[STREAM, newSeriesBatch(4, "c", clock)]]),
      );
      expect(recorded).toHaveLength(2);

      // The one admitted series persisted; the metric name counts exactly 1.
      const [nameRow] = await db
        .select({ seriesCount: schema.metricNames.seriesCount })
        .from(schema.metricNames);
      expect(Number(nameRow!.seriesCount)).toBe(1);
    });
  },
);
