import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import path from "node:path";
import type {
  Logger,
  SafeDatabase,
  ScopedTransaction,
} from "@checkstack/backend-api";
import {
  withTestDb,
  isIntegrationEnabled,
  type TestDb,
} from "@checkstack/test-utils-backend";
import { DEFAULT_LOG_STREAM_CONFIG } from "@checkstack/logstream-common";
import * as schema from "../schema";
import { createStorage } from "../storage";
import { floorToMinute, floorToHour } from "../storage";
import { createDbReader, loadStreamHandle } from "./reader";
import {
  runStreamRetention,
  rollupSeverityBuckets,
  deleteExpiredEvents,
} from "./retention";
import { runCleanupPass } from "./maintenance";

const noopLogger: Logger = {
  info() {},
  error() {},
  warn() {},
  debug() {},
};

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");
const STREAM = "stream-health-it";
const CREATED = new Date("2026-01-01T00:00:00.000Z");

describe.skipIf(!isIntegrationEnabled())("logstream health (integration)", () => {
  let test: TestDb<typeof schema>;

  beforeAll(async () => {
    test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
  });
  afterAll(async () => {
    await test.dispose();
  });

  beforeEach(async () => {
    const { db } = test;
    await db.delete(schema.logSeverityBuckets);
    await db.delete(schema.logPatternBuckets);
    await db.delete(schema.logSeverityHourly);
    await db.delete(schema.logPatternHourly);
    await db.delete(schema.logPatterns);
    await db.delete(schema.logEvents);
    await db.delete(schema.logStreamActivity);
    await db.delete(schema.logStreams);
    await db.insert(schema.logStreams).values({
      id: STREAM,
      name: "Health IT",
      config: DEFAULT_LOG_STREAM_CONFIG,
      createdAt: CREATED,
      updatedAt: CREATED,
    });
  });

  it("reads windowed severity + pattern metrics from seeded buckets", async () => {
    const { db } = test;
    const storage = createStorage({ db });
    const from = new Date("2026-06-01T12:00:00.000Z");
    const to = new Date("2026-06-01T12:05:00.000Z");
    const inWindow = floorToMinute(new Date("2026-06-01T12:02:00.000Z"));
    const outWindow = floorToMinute(new Date("2026-06-01T11:00:00.000Z"));

    await storage.upsertSeverityBuckets({
      runner: db,
      deltas: [
        { streamId: STREAM, bucketStart: inWindow, band: "error", count: 7 },
        { streamId: STREAM, bucketStart: inWindow, band: "info", count: 20 },
        { streamId: STREAM, bucketStart: outWindow, band: "error", count: 99 },
      ],
    });
    await db.insert(schema.logPatternBuckets).values([
      { streamId: STREAM, bucketStart: inWindow, patternId: "pat-a", count: 5 },
      { streamId: STREAM, bucketStart: inWindow, patternId: "pat-b", count: 3 },
      { streamId: STREAM, bucketStart: outWindow, patternId: "pat-c", count: 1 },
    ]);
    await db.insert(schema.logPatterns).values([
      {
        streamId: STREAM,
        id: "pat-a",
        template: "a <*>",
        tokenCount: 2,
        firstSeenAt: new Date("2026-06-01T12:01:00.000Z"),
        lastSeenAt: new Date("2026-06-01T12:02:00.000Z"),
        sampleBody: "a 1",
        totalCount: 5,
        severityMax: 18,
      },
      {
        streamId: STREAM,
        id: "pat-b",
        template: "b <*>",
        tokenCount: 2,
        firstSeenAt: new Date("2026-05-01T00:00:00.000Z"),
        lastSeenAt: new Date("2026-06-01T12:02:00.000Z"),
        sampleBody: "b 1",
        totalCount: 3,
        severityMax: 14,
      },
    ]);

    const handle = await loadStreamHandle({ db, streamId: STREAM });
    expect(handle).not.toBeNull();
    const reader = createDbReader({ db, storage, handle: handle! });

    const severity = await reader.readSeverityTotals({ from, to });
    expect(severity.error).toBe(7);
    expect(severity.info).toBe(20);

    // pat-a first-seen inside window, pat-b first-seen before -> newPatternCount 1.
    expect(await reader.readNewPatternCount({ from, to })).toBe(1);
    // pat-a + pat-b have buckets in window -> distinct 2.
    expect(await reader.readDistinctPatternCount({ from, to })).toBe(2);
    expect(
      await reader.readPatternOccurrence({ patternId: "pat-a", from, to }),
    ).toBe(5);
    expect(await reader.readPatternLastSeenAt({ patternId: "pat-a" })).toEqual(
      new Date("2026-06-01T12:02:00.000Z"),
    );
  });

  it("deletes raw events strictly older than the cutoff (boundary)", async () => {
    const { db } = test;
    const cutoff = new Date("2026-06-10T00:00:00.000Z");
    await db.insert(schema.logEvents).values([
      mkEvent("2026-06-09T23:59:59.000Z"), // older -> deleted
      mkEvent("2026-06-10T00:00:00.000Z"), // == cutoff -> kept (lt is strict)
      mkEvent("2026-06-11T00:00:00.000Z"), // newer -> kept
    ]);
    const deleted = await deleteExpiredEvents({
      db,
      streamId: STREAM,
      cutoff,
      batchSize: 100,
    });
    expect(deleted).toBe(1);
    const remaining = await db.select().from(schema.logEvents);
    expect(remaining).toHaveLength(2);
  });

  it("rolls minute severity buckets into hourly sums and removes the minute rows", async () => {
    const { db } = test;
    const storage = createStorage({ db });
    const minuteCutoff = new Date("2026-06-10T00:00:00.000Z");
    const h = floorToHour(new Date("2026-06-09T10:00:00.000Z"));
    await storage.upsertSeverityBuckets({
      runner: db,
      deltas: [
        { streamId: STREAM, bucketStart: new Date(h.getTime()), band: "error", count: 2 },
        {
          streamId: STREAM,
          bucketStart: new Date(h.getTime() + 30 * 60_000),
          band: "error",
          count: 3,
        },
        {
          streamId: STREAM,
          bucketStart: new Date("2026-06-20T00:00:00.000Z"),
          band: "error",
          count: 50,
        }, // newer than cutoff -> untouched
      ],
    });

    await rollupSeverityBuckets({ db, streamId: STREAM, minuteCutoff });

    const hourly = await db.select().from(schema.logSeverityHourly);
    expect(hourly).toHaveLength(1);
    expect(Number(hourly[0].count)).toBe(5);
    expect(hourly[0].bucketStart).toEqual(h);

    // The rolled minute rows are gone; the newer one survives.
    const minutes = await db.select().from(schema.logSeverityBuckets);
    expect(minutes).toHaveLength(1);
    expect(Number(minutes[0].count)).toBe(50);
  });

  it("is idempotent: rolling up twice does not double-count hourly totals", async () => {
    const { db } = test;
    const storage = createStorage({ db });
    const minuteCutoff = new Date("2026-06-10T00:00:00.000Z");
    const h = floorToHour(new Date("2026-06-09T10:00:00.000Z"));
    await storage.upsertSeverityBuckets({
      runner: db,
      deltas: [
        { streamId: STREAM, bucketStart: new Date(h.getTime()), band: "error", count: 2 },
        {
          streamId: STREAM,
          bucketStart: new Date(h.getTime() + 30 * 60_000),
          band: "error",
          count: 3,
        },
      ],
    });

    await rollupSeverityBuckets({ db, streamId: STREAM, minuteCutoff });
    // A second pass (simulating a BullMQ retry of the whole maintenance job)
    // finds the minute rows already gone, so it adds nothing to hourly.
    await rollupSeverityBuckets({ db, streamId: STREAM, minuteCutoff });

    const hourly = await db.select().from(schema.logSeverityHourly);
    expect(hourly).toHaveLength(1);
    expect(Number(hourly[0].count)).toBe(5);
  });

  it("rolls back both the hourly insert and the minute delete when the batch aborts", async () => {
    const { db } = test;
    const storage = createStorage({ db });
    const minuteCutoff = new Date("2026-06-10T00:00:00.000Z");
    const h = floorToHour(new Date("2026-06-09T10:00:00.000Z"));
    await storage.upsertSeverityBuckets({
      runner: db,
      deltas: [
        { streamId: STREAM, bucketStart: new Date(h.getTime()), band: "error", count: 2 },
      ],
    });

    // A crash between the hourly UPSERT and the minute DELETE must roll BOTH
    // back (Postgres), or a retry would re-roll the still-present minute rows
    // and double-count. Simulate it by aborting the transaction after its body.
    await expect(
      rollupSeverityBuckets({
        db: abortAfterBodyDb(db),
        streamId: STREAM,
        minuteCutoff,
      }),
    ).rejects.toThrow(/simulated crash/);

    // Nothing committed: no hourly row, and the minute rows are still present.
    expect(await db.select().from(schema.logSeverityHourly)).toHaveLength(0);
    expect(await db.select().from(schema.logSeverityBuckets)).toHaveLength(1);

    // A clean retry now produces exactly the correct single rollup.
    await rollupSeverityBuckets({ db, streamId: STREAM, minuteCutoff });
    const hourly = await db.select().from(schema.logSeverityHourly);
    expect(hourly).toHaveLength(1);
    expect(Number(hourly[0].count)).toBe(2);
    expect(await db.select().from(schema.logSeverityBuckets)).toHaveLength(0);
  });

  it("runs the full retention pass without touching in-retention data", async () => {
    const { db } = test;
    const storage = createStorage({ db });
    const now = new Date("2026-06-10T00:00:00.000Z");
    // Fresh event well within rawRetentionDays (default 3) stays.
    await db.insert(schema.logEvents).values(mkEvent("2026-06-09T12:00:00.000Z"));
    // Fresh minute bucket within minuteRetentionHours (default 48) stays.
    await storage.upsertSeverityBuckets({
      runner: db,
      deltas: [
        {
          streamId: STREAM,
          bucketStart: floorToMinute(new Date("2026-06-09T23:00:00.000Z")),
          band: "warn",
          count: 4,
        },
      ],
    });

    await runStreamRetention({
      db,
      streamId: STREAM,
      config: DEFAULT_LOG_STREAM_CONFIG,
      now,
    });

    expect(await db.select().from(schema.logEvents)).toHaveLength(1);
    expect(await db.select().from(schema.logSeverityBuckets)).toHaveLength(1);
  });

  it("retention keeps user + referenced patterns, deletes an unreferenced quiet one", async () => {
    const { db } = test;
    const now = new Date("2026-06-10T00:00:00.000Z");
    // All three went quiet long ago (well past the hourly cutoff) with NO
    // remaining bucket rows, so only protection keeps them.
    const quiet = new Date("2025-01-01T00:00:00.000Z");
    await db.insert(schema.logPatterns).values([
      mkPattern({ id: "p-user", lastSeenAt: quiet, origin: "user" }),
      mkPattern({ id: "p-referenced", lastSeenAt: quiet }),
      mkPattern({ id: "p-unreferenced", lastSeenAt: quiet }),
    ]);

    await runStreamRetention({
      db,
      streamId: STREAM,
      config: DEFAULT_LOG_STREAM_CONFIG,
      now,
      protectedPatternIds: ["p-referenced"],
    });

    const survivors = (await db.select().from(schema.logPatterns))
      .map((p) => p.id)
      .sort();
    expect(survivors).toEqual(["p-referenced", "p-user"]);
  });

  it("cleanup skips the stale-pattern delete when the reference resolver fails", async () => {
    const { db } = test;
    const now = new Date("2026-06-10T00:00:00.000Z");
    const quiet = new Date("2025-01-01T00:00:00.000Z");
    await db
      .insert(schema.logPatterns)
      .values(mkPattern({ id: "p-would-delete", lastSeenAt: quiet }));

    // A resolver that throws means we cannot prove the pattern is unreferenced,
    // so the sweep is skipped this run (never delete on an unknown).
    await runCleanupPass({
      db,
      logger: noopLogger,
      now,
      getReferencedPatternIds: async () => {
        throw new Error("healthcheck RPC down");
      },
    });

    const remaining = await db.select().from(schema.logPatterns);
    expect(remaining.map((p) => p.id)).toEqual(["p-would-delete"]);
  });

  it("rolls up and expires pattern-variable buckets like the pattern buckets", async () => {
    const { db } = test;
    const storage = createStorage({ db });
    const now = new Date("2026-06-10T00:00:00.000Z");
    // Older than minuteRetentionHours (48) -> rolled into hourly, minute dropped.
    const oldMinute = floorToMinute(new Date("2026-06-07T10:30:00.000Z"));
    await storage.upsertVariableBuckets({
      runner: db,
      deltas: [
        {
          streamId: STREAM,
          patternId: "p-var",
          varIndex: 0,
          bucketStart: oldMinute,
          count: 2,
          sum: 30,
          min: 10,
          max: 20,
        },
      ],
    });

    await runStreamRetention({
      db,
      streamId: STREAM,
      config: DEFAULT_LOG_STREAM_CONFIG,
      now,
    });

    expect(
      await db.select().from(schema.logPatternVariableBuckets),
    ).toHaveLength(0);
    const hourly = await db
      .select()
      .from(schema.logPatternVariableHourly);
    expect(hourly).toHaveLength(1);
    expect(Number(hourly[0].count)).toBe(2);
    expect(Number(hourly[0].sum)).toBe(30);
    expect(Number(hourly[0].min)).toBe(10);
    expect(Number(hourly[0].max)).toBe(20);
  });
});

/**
 * Wrap a scoped db so every `transaction()` runs its body on the REAL
 * transaction and then throws, forcing Postgres to roll the whole transaction
 * back - a stand-in for a pod crashing mid-commit. Used to prove the rollup's
 * insert + delete are atomic.
 */
function abortAfterBodyDb(
  db: SafeDatabase<typeof schema>,
): SafeDatabase<typeof schema> {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "transaction") {
        return async (
          fn: (tx: ScopedTransaction<typeof schema>) => Promise<unknown>,
        ) =>
          target.transaction(async (tx) => {
            await fn(tx);
            throw new Error("simulated crash after rollup body");
          });
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function mkEvent(ts: string) {
  return {
    streamId: STREAM,
    ts: new Date(ts),
    observedAt: new Date(ts),
    severityNumber: 18,
    band: "error" as const,
    body: "boom",
  };
}

function mkPattern({
  id,
  lastSeenAt,
  origin = "mined",
}: {
  id: string;
  lastSeenAt: Date;
  origin?: "mined" | "user";
}) {
  return {
    id,
    streamId: STREAM,
    template: `${id} <*>`,
    tokenCount: 2,
    firstSeenAt: CREATED,
    lastSeenAt,
    sampleBody: `${id} sample`,
    origin,
  };
}
