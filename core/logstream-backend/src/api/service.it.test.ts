import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import path from "node:path";
import { call } from "@orpc/server";
import {
  withTestDb,
  isIntegrationEnabled,
  createMockLogger,
  type TestDb,
} from "@checkstack/test-utils-backend";
import { createMockRpcContext, type RpcContext } from "@checkstack/backend-api";
import type { CacheManager, CacheProvider } from "@checkstack/cache-api";
import { DEFAULT_LOG_STREAM_CONFIG } from "@checkstack/logstream-common";
import type { EventCursor } from "@checkstack/logstream-common";
import * as schema from "../schema";
import { createStorage } from "../storage";
import { createLogstreamService, type LogstreamService } from "./service";
import { createLogstreamRouter } from "./router";
import type { SystemLinkAuthorizer } from "./system-links-auth";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");

/** A no-op in-memory cache manager: the service only touches it to invalidate
 * ingest-token entries after a delete, which is a plain `delete(key)` here. */
function noopCacheManager(): CacheManager {
  const provider: CacheProvider = {
    get: async () => undefined,
    set: async () => {},
    delete: async () => {},
    deleteByPrefix: async () => 0,
    has: async () => false,
  };
  return { getProvider: () => provider } as unknown as CacheManager;
}

describe.skipIf(!isIntegrationEnabled())("logstream service (integration)", () => {
  let test: TestDb<typeof schema>;
  let service: LogstreamService;

  beforeAll(async () => {
    test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
    service = createLogstreamService({
      db: test.db,
      storage: createStorage({ db: test.db }),
      cacheManager: noopCacheManager(),
      logger: createMockLogger(),
    });
  });
  afterAll(async () => {
    await test.dispose();
  });

  // ==========================================================================
  // Keyset pagination over rows sharing a timestamp
  // ==========================================================================

  describe("searchEvents keyset cursor with equal timestamps", () => {
    const STREAM = "keyset-stream";
    const SHARED_TS = new Date("2026-07-12T10:00:00.000Z");

    beforeEach(async () => {
      const { db } = test;
      await db.delete(schema.logEvents);
      await db.delete(schema.logStreams);
      await db.insert(schema.logStreams).values({
        id: STREAM,
        name: "Keyset IT",
        config: DEFAULT_LOG_STREAM_CONFIG,
        createdAt: SHARED_TS,
        updatedAt: SHARED_TS,
      });
      // Five rows with the SAME ts and distinct (identity-assigned) ids. The
      // keyset must tie-break on id so no row is skipped or served twice when a
      // page boundary falls in the middle of the shared-timestamp cluster.
      await db.insert(schema.logEvents).values(
        Array.from({ length: 5 }, (_, i) => ({
          streamId: STREAM,
          ts: SHARED_TS,
          observedAt: SHARED_TS,
          severityNumber: 9,
          band: "info" as const,
          body: `line ${i}`,
        })),
      );
    });

    it("returns every row exactly once across pages (limit < cluster size)", async () => {
      const seen: string[] = [];
      let cursor: EventCursor | undefined;
      // limit 2 < 5 rows, so a page boundary lands inside the equal-ts cluster.
      for (let guard = 0; guard < 10; guard++) {
        const page = await service.searchEvents({
          streamId: STREAM,
          limit: 2,
          ...(cursor ? { cursor } : {}),
        });
        seen.push(...page.events.map((e) => e.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      // Exactly the five rows, each once, no duplicates and none skipped.
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);

      // Every id from the table appears in the paginated set.
      const allIds = (await test.db.select().from(schema.logEvents)).map((r) =>
        String(r.id),
      );
      expect(new Set(seen)).toEqual(new Set(allIds));

      // Ids descend across the shared-ts cluster (the id tie-break, DESC).
      const numeric = seen.map(Number);
      expect(numeric).toEqual([...numeric].sort((a, b) => b - a));
    });
  });

  // ==========================================================================
  // findEventsByTraceId: cross-stream grouping, per-stream cap, window, order
  // ==========================================================================

  describe("findEventsByTraceId", () => {
    const STREAM_A = "trace-stream-a";
    const STREAM_B = "trace-stream-b";
    const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
    const OTHER_TRACE = "00000000000000000000000000000000";
    const BASE = new Date("2026-07-12T12:00:00.000Z").getTime();
    const at = (offsetMs: number) => new Date(BASE + offsetMs);
    // A window wide enough to cover every fixture event (from/to are required).
    const WINDOW = { from: at(-60_000), to: at(60_000) };

    beforeEach(async () => {
      const { db } = test;
      await db.delete(schema.logEvents);
      await db.delete(schema.logStreams);
      await db.insert(schema.logStreams).values([
        { id: STREAM_A, name: "Stream A", config: DEFAULT_LOG_STREAM_CONFIG },
        { id: STREAM_B, name: "Stream B", config: DEFAULT_LOG_STREAM_CONFIG },
      ]);
      // Stream A: three lines carrying TRACE at ascending ts, one with a
      // different trace, one with no trace. Stream B: two lines with TRACE.
      await db.insert(schema.logEvents).values([
        row(STREAM_A, at(0), TRACE, "a-oldest"),
        row(STREAM_A, at(1000), TRACE, "a-middle"),
        row(STREAM_A, at(2000), TRACE, "a-newest"),
        row(STREAM_A, at(3000), OTHER_TRACE, "a-other-trace"),
        row(STREAM_A, at(4000), null, "a-no-trace"),
        row(STREAM_B, at(500), TRACE, "b-oldest"),
        row(STREAM_B, at(1500), TRACE, "b-newest"),
      ]);
    });

    function row(
      streamId: string,
      ts: Date,
      traceId: string | null,
      body: string,
    ) {
      return {
        streamId,
        ts,
        observedAt: ts,
        severityNumber: 9,
        band: "info" as const,
        body,
        ...(traceId ? { traceId } : {}),
      };
    }

    it("groups the trace's events per stream, newest-first, keyed on stream id", async () => {
      const { matches } = await service.findEventsByTraceId({
        traceId: TRACE,
        ...WINDOW,
        limitPerStream: 50,
      });
      // Two streams matched; each match's `id` IS the stream id (listKey key).
      expect(new Set(matches.map((m) => m.id))).toEqual(
        new Set([STREAM_A, STREAM_B]),
      );

      const a = matches.find((m) => m.id === STREAM_A)!;
      expect(a.streamName).toBe("Stream A");
      // Only TRACE lines, newest first (no OTHER_TRACE / no-trace line).
      expect(a.events.map((e) => e.body)).toEqual([
        "a-newest",
        "a-middle",
        "a-oldest",
      ]);
      expect(a.events.every((e) => e.traceId === TRACE)).toBe(true);

      const b = matches.find((m) => m.id === STREAM_B)!;
      expect(b.events.map((e) => e.body)).toEqual(["b-newest", "b-oldest"]);
    });

    it("caps events PER stream at limitPerStream (keeping the newest)", async () => {
      const { matches } = await service.findEventsByTraceId({
        traceId: TRACE,
        ...WINDOW,
        limitPerStream: 2,
      });
      const a = matches.find((m) => m.id === STREAM_A)!;
      // Stream A has three TRACE lines; only the two newest survive the cap.
      expect(a.events.map((e) => e.body)).toEqual(["a-newest", "a-middle"]);
      const b = matches.find((m) => m.id === STREAM_B)!;
      expect(b.events.map((e) => e.body)).toEqual(["b-newest", "b-oldest"]);
    });

    it("honors the required time window", async () => {
      const { matches } = await service.findEventsByTraceId({
        traceId: TRACE,
        from: at(1800),
        to: at(2500),
        limitPerStream: 50,
      });
      // Only Stream A's newest line (2000ms) falls inside [1800ms, 2500ms];
      // Stream B's newest is at 1500ms, before the window.
      expect(matches.map((m) => m.id)).toEqual([STREAM_A]);
      expect(matches[0]!.events.map((e) => e.body)).toEqual(["a-newest"]);
    });

    it("normalizes a dashed/uppercase input so it matches the stored (normalized) id", async () => {
      // The stored rows carry the canonical lowercase-hex TRACE; an operator
      // pasting the dashed/uppercase form must still correlate.
      const dashedUpper = "4BF9-2F35-77B3-4DA6-A3CE-929D-0E0E-4736";
      const { matches } = await service.findEventsByTraceId({
        traceId: dashedUpper,
        ...WINDOW,
        limitPerStream: 50,
      });
      expect(new Set(matches.map((m) => m.id))).toEqual(
        new Set([STREAM_A, STREAM_B]),
      );
    });

    it("returns no matches for an unknown trace id", async () => {
      const { matches } = await service.findEventsByTraceId({
        traceId: "deadbeefdeadbeefdeadbeefdeadbeef",
        ...WINDOW,
        limitPerStream: 50,
      });
      expect(matches).toEqual([]);
    });

    it("returns no matches when the input normalizes to nothing (never queries)", async () => {
      const { matches } = await service.findEventsByTraceId({
        traceId: "  --  ",
        ...WINDOW,
        limitPerStream: 50,
      });
      expect(matches).toEqual([]);
    });
  });

  // ==========================================================================
  // searchEvents traceId filter
  // ==========================================================================

  describe("searchEvents traceId filter", () => {
    const STREAM = "trace-filter-stream";
    const TRACE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const TS = new Date("2026-07-12T13:00:00.000Z");

    beforeEach(async () => {
      const { db } = test;
      await db.delete(schema.logEvents);
      await db.delete(schema.logStreams);
      await db.insert(schema.logStreams).values({
        id: STREAM,
        name: "Filter",
        config: DEFAULT_LOG_STREAM_CONFIG,
      });
      await db.insert(schema.logEvents).values([
        {
          streamId: STREAM,
          ts: TS,
          observedAt: TS,
          severityNumber: 9,
          band: "info" as const,
          body: "matching",
          traceId: TRACE,
        },
        {
          streamId: STREAM,
          ts: TS,
          observedAt: TS,
          severityNumber: 9,
          band: "info" as const,
          body: "other-trace",
          traceId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        {
          streamId: STREAM,
          ts: TS,
          observedAt: TS,
          severityNumber: 9,
          band: "info" as const,
          body: "no-trace",
        },
      ]);
    });

    it("returns only events whose traceId matches exactly", async () => {
      const { events } = await service.searchEvents({
        streamId: STREAM,
        traceId: TRACE,
        limit: 100,
      });
      expect(events.map((e) => e.body)).toEqual(["matching"]);
    });

    it("normalizes a dashed/uppercase traceId input before matching", async () => {
      // Uppercase + dashed form of TRACE; must normalize back and match the row.
      const { events } = await service.searchEvents({
        streamId: STREAM,
        traceId: "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA",
        limit: 100,
      });
      expect(events.map((e) => e.body)).toEqual(["matching"]);
    });

    it("returns no events when the traceId input normalizes to nothing", async () => {
      const { events } = await service.searchEvents({
        streamId: STREAM,
        traceId: "  --  ",
        limit: 100,
      });
      expect(events).toEqual([]);
    });
  });

  // ==========================================================================
  // Important-events timeline keyset over rows sharing a timestamp
  // ==========================================================================

  describe("listImportantEvents keyset cursor with equal timestamps", () => {
    const STREAM = "evt-keyset-stream";
    const SHARED_TS = new Date("2026-07-12T11:00:00.000Z");

    beforeEach(async () => {
      const { db } = test;
      await db.delete(schema.logImportantEvents);
      await db.delete(schema.logStreams);
      await db.insert(schema.logStreams).values({
        id: STREAM,
        name: "Event Keyset IT",
        config: DEFAULT_LOG_STREAM_CONFIG,
        createdAt: SHARED_TS,
        updatedAt: SHARED_TS,
      });
      // Five throttle/pattern events at the SAME ts: an offset-by-ts cursor would
      // skip or repeat rows when a page boundary lands inside the cluster.
      await db.insert(schema.logImportantEvents).values(
        Array.from({ length: 5 }, (_, i) => ({
          id: `evt-${i}`,
          streamId: STREAM,
          ts: SHARED_TS,
          type: "spike" as const,
          title: `event ${i}`,
        })),
      );
    });

    it("returns every event exactly once across pages (limit < cluster size)", async () => {
      const seen: string[] = [];
      let cursor: { ts: Date; id: string } | undefined;
      let pages = 0;
      for (;;) {
        const page = await service.listImportantEvents({
          streamId: STREAM,
          limit: 2,
          ...(cursor ? { cursor } : {}),
        });
        pages++;
        seen.push(...page.events.map((e) => e.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
        if (pages > 10) throw new Error("paging did not terminate");
      }
      expect(pages).toBe(3); // 2 + 2 + 1
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5); // each row once, none skipped
    });
  });

  // ==========================================================================
  // deleteStream cascade against a real database
  // ==========================================================================

  describe("deleteStream cascade", () => {
    const TARGET = "target-stream";
    const SURVIVOR = "survivor-stream";
    const TS = new Date("2026-07-12T10:00:00.000Z");

    async function seedStream(id: string) {
      const { db } = test;
      await db.insert(schema.logStreams).values({
        id,
        name: id,
        config: DEFAULT_LOG_STREAM_CONFIG,
        createdAt: TS,
        updatedAt: TS,
      });
      await db.insert(schema.logStreamTokens).values({
        id: `${id}-tok`,
        streamId: id,
        name: "shipper",
        tokenHash: `${id}-hash`,
        tokenPrefix: `${id}-pre`,
      });
      await db.insert(schema.logEvents).values([
        {
          streamId: id,
          ts: TS,
          observedAt: TS,
          severityNumber: 18,
          band: "error" as const,
          body: "boom",
        },
        {
          streamId: id,
          ts: TS,
          observedAt: TS,
          severityNumber: 9,
          band: "info" as const,
          body: "hi",
        },
      ]);
      await db.insert(schema.logPatterns).values({
        id: `${id}-pat`,
        streamId: id,
        template: "boom <*>",
        tokenCount: 2,
        firstSeenAt: TS,
        lastSeenAt: TS,
        sampleBody: "boom 1",
        totalCount: 2,
        severityMax: 18,
      });
      await db
        .insert(schema.logSeverityBuckets)
        .values({ streamId: id, bucketStart: TS, band: "error", count: 3 });
      await db.insert(schema.logPatternBuckets).values({
        streamId: id,
        bucketStart: TS,
        patternId: `${id}-pat`,
        count: 3,
      });
      await db
        .insert(schema.logSeverityHourly)
        .values({ streamId: id, bucketStart: TS, band: "error", count: 5 });
      await db.insert(schema.logPatternHourly).values({
        streamId: id,
        bucketStart: TS,
        patternId: `${id}-pat`,
        count: 5,
      });
      await db.insert(schema.logImportantEvents).values({
        id: `${id}-evt`,
        streamId: id,
        ts: TS,
        type: "spike",
        title: "Error spike",
      });
      await db.insert(schema.logStreamActivity).values({
        streamId: id,
        lastReceivedAt: TS,
        lastFlushAt: TS,
        approxRatePerMinute: 10,
      });
    }

    beforeEach(async () => {
      const { db } = test;
      // Order-independent full wipe of every stream-scoped table.
      await db.delete(schema.logImportantEvents);
      await db.delete(schema.logPatternHourly);
      await db.delete(schema.logSeverityHourly);
      await db.delete(schema.logPatternBuckets);
      await db.delete(schema.logSeverityBuckets);
      await db.delete(schema.logPatterns);
      await db.delete(schema.logEvents);
      await db.delete(schema.logStreamTokens);
      await db.delete(schema.logStreamActivity);
      await db.delete(schema.logStreams);
      await seedStream(TARGET);
      await seedStream(SURVIVOR);
    });

    it("removes every stream-scoped row for the target and leaves other streams intact", async () => {
      await service.deleteStream({ id: TARGET });

      const { db } = test;
      // Read every stream-scoped table in full, then partition by streamId in
      // JS - fully typed, no dynamic-table casts. Each `select()` returns the
      // table's own row type.
      const [
        streams,
        tokens,
        events,
        patterns,
        sevBuckets,
        patBuckets,
        sevHourly,
        patHourly,
        important,
        activity,
      ] = await Promise.all([
        db.select().from(schema.logStreams),
        db.select().from(schema.logStreamTokens),
        db.select().from(schema.logEvents),
        db.select().from(schema.logPatterns),
        db.select().from(schema.logSeverityBuckets),
        db.select().from(schema.logPatternBuckets),
        db.select().from(schema.logSeverityHourly),
        db.select().from(schema.logPatternHourly),
        db.select().from(schema.logImportantEvents),
        db.select().from(schema.logStreamActivity),
      ]);

      const forTarget = <T extends { streamId: string }>(rows: T[]) =>
        rows.filter((r) => r.streamId === TARGET).length;
      const forSurvivor = <T extends { streamId: string }>(rows: T[]) =>
        rows.filter((r) => r.streamId === SURVIVOR).length;

      // Only the survivor's stream row remains.
      expect(streams.map((r) => r.id)).toEqual([SURVIVOR]);

      // Not a single target-scoped row survives in any child table.
      expect(forTarget(tokens)).toBe(0);
      expect(forTarget(events)).toBe(0);
      expect(forTarget(patterns)).toBe(0);
      expect(forTarget(sevBuckets)).toBe(0);
      expect(forTarget(patBuckets)).toBe(0);
      expect(forTarget(sevHourly)).toBe(0);
      expect(forTarget(patHourly)).toBe(0);
      expect(forTarget(important)).toBe(0);
      expect(forTarget(activity)).toBe(0);

      // The survivor keeps all of its rows (delete was correctly scoped).
      expect(forSurvivor(events)).toBe(2);
      expect(forSurvivor(tokens)).toBe(1);
      expect(forSurvivor(patterns)).toBe(1);
      expect(forSurvivor(important)).toBe(1);
      expect(forSurvivor(activity)).toBe(1);
    });
  });

  // ==========================================================================
  // listPatterns ordering: user patterns surface above chatty mined ones
  // ==========================================================================

  describe("listPatterns picker ordering", () => {
    const STREAM = "order-stream";
    const OLD = new Date("2026-01-01T00:00:00.000Z");
    const RECENT = new Date("2026-07-12T09:00:00.000Z");

    beforeEach(async () => {
      const { db } = test;
      await db.delete(schema.logPatterns);
      await db.delete(schema.logStreams);
      await db.insert(schema.logStreams).values({
        id: STREAM,
        name: "Order IT",
        config: DEFAULT_LOG_STREAM_CONFIG,
        createdAt: OLD,
        updatedAt: OLD,
      });
    });

    it("returns a quiet USER pattern ahead of active MINED ones", async () => {
      const { db } = test;
      await db.insert(schema.logPatterns).values([
        // A chatty mined pattern seen just now.
        {
          id: "mined-active",
          streamId: STREAM,
          template: "mined active <*>",
          tokenCount: 3,
          firstSeenAt: OLD,
          lastSeenAt: RECENT,
          sampleBody: "mined active 1",
          totalCount: 9999,
          severityMax: 9,
          origin: "mined",
        },
        // A user pattern that has been quiet for months.
        {
          id: "user-quiet",
          streamId: STREAM,
          template: "user quiet <*>",
          tokenCount: 3,
          firstSeenAt: OLD,
          lastSeenAt: OLD,
          sampleBody: "user quiet 1",
          totalCount: 1,
          severityMax: 9,
          origin: "user",
        },
      ]);

      const patterns = await service.listPatterns({
        streamId: STREAM,
        limit: 100,
        includeHidden: false,
        orderBy: "lastSeenAt",
      });
      // User-origin sorts first despite its far-older lastSeenAt.
      expect(patterns.map((p) => p.id)).toEqual(["user-quiet", "mined-active"]);
    });

    it("orders user patterns among themselves by recency", async () => {
      const { db } = test;
      await db.insert(schema.logPatterns).values([
        {
          id: "user-old",
          streamId: STREAM,
          template: "user old <*>",
          tokenCount: 3,
          firstSeenAt: OLD,
          lastSeenAt: OLD,
          sampleBody: "user old 1",
          totalCount: 1,
          severityMax: 9,
          origin: "user",
        },
        {
          id: "user-recent",
          streamId: STREAM,
          template: "user recent <*>",
          tokenCount: 3,
          firstSeenAt: OLD,
          lastSeenAt: RECENT,
          sampleBody: "user recent 1",
          totalCount: 1,
          severityMax: 9,
          origin: "user",
        },
      ]);

      const patterns = await service.listPatterns({
        streamId: STREAM,
        limit: 100,
        includeHidden: false,
        orderBy: "lastSeenAt",
      });
      // Both are user-origin, so the recency tiebreak applies.
      expect(patterns.map((p) => p.id)).toEqual(["user-recent", "user-old"]);
    });

    it("excludes hidden patterns by default and includes them on request", async () => {
      const { db } = test;
      await db.insert(schema.logPatterns).values([
        {
          id: "visible",
          streamId: STREAM,
          template: "visible <*>",
          tokenCount: 2,
          firstSeenAt: OLD,
          lastSeenAt: RECENT,
          sampleBody: "visible 1",
          totalCount: 5,
          severityMax: 9,
          origin: "mined",
        },
        {
          id: "concealed",
          streamId: STREAM,
          template: "concealed <*>",
          tokenCount: 2,
          firstSeenAt: OLD,
          lastSeenAt: RECENT,
          sampleBody: "concealed 1",
          totalCount: 999,
          severityMax: 9,
          origin: "mined",
          hidden: true,
        },
      ]);

      const visibleOnly = await service.listPatterns({
        streamId: STREAM,
        limit: 100,
        includeHidden: false,
        orderBy: "totalCount",
      });
      expect(visibleOnly.map((p) => p.id)).toEqual(["visible"]);

      const all = await service.listPatterns({
        streamId: STREAM,
        limit: 100,
        includeHidden: true,
        orderBy: "totalCount",
      });
      expect(all.map((p) => p.id)).toEqual(["concealed", "visible"]);
      expect(all[0]?.hidden).toBe(true);
    });

    it("filters by derived severity band and orders by volume", async () => {
      const { db } = test;
      const base = {
        streamId: STREAM,
        tokenCount: 2,
        firstSeenAt: OLD,
        lastSeenAt: RECENT,
        origin: "mined" as const,
      };
      await db.insert(schema.logPatterns).values([
        // severityMax 18 -> error band.
        {
          ...base,
          id: "err-small",
          template: "err small <*>",
          sampleBody: "err small 1",
          totalCount: 10,
          severityMax: 18,
        },
        {
          ...base,
          id: "err-big",
          template: "err big <*>",
          sampleBody: "err big 1",
          totalCount: 100,
          severityMax: 18,
        },
        // severityMax 9 -> info band.
        {
          ...base,
          id: "informational",
          template: "informational <*>",
          sampleBody: "informational 1",
          totalCount: 5000,
          severityMax: 9,
        },
        // severityMax 0 (never-seen user default) -> info via the else-branch.
        {
          ...base,
          id: "unspecified",
          template: "unspecified <*>",
          sampleBody: "unspecified 1",
          totalCount: 1,
          severityMax: 0,
        },
      ]);

      const errors = await service.listPatterns({
        streamId: STREAM,
        limit: 100,
        includeHidden: false,
        bands: ["error"],
        orderBy: "totalCount",
      });
      expect(errors.map((p) => p.id)).toEqual(["err-big", "err-small"]);

      // The out-of-range severityMax 0 lands in 'info', exactly like the DTO's
      // bandFromSeverityNumber default.
      const infos = await service.listPatterns({
        streamId: STREAM,
        limit: 100,
        includeHidden: false,
        bands: ["info"],
        orderBy: "totalCount",
      });
      expect(infos.map((p) => p.id)).toEqual(["informational", "unspecified"]);
    });
  });

  // ==========================================================================
  // System links (explicit stream -> catalog-system mapping)
  // ==========================================================================

  describe("system links", () => {
    const STREAM_A = "links-stream-a";
    const STREAM_B = "links-stream-b";
    const TS = new Date("2026-07-14T10:00:00.000Z");

    beforeEach(async () => {
      const { db } = test;
      await db.delete(schema.logStreamSystemLinks);
      await db.delete(schema.logImportantEvents);
      await db.delete(schema.logEvents);
      await db.delete(schema.logStreams);
      await db.insert(schema.logStreams).values([
        { id: STREAM_A, name: "Stream A", config: DEFAULT_LOG_STREAM_CONFIG, createdAt: TS, updatedAt: TS },
        { id: STREAM_B, name: "Stream B", config: DEFAULT_LOG_STREAM_CONFIG, createdAt: TS, updatedAt: TS },
      ]);
    });

    const sortedLinks = async (streamId: string) =>
      [...(await service.listSystemLinks({ streamId })).systemIds].sort();

    it("setSystemLinks replaces the whole set (idempotent, de-duped, clearable)", async () => {
      await service.setSystemLinks({
        streamId: STREAM_A,
        systemIds: ["sys-1", "sys-2", "sys-2"],
      });
      expect(await sortedLinks(STREAM_A)).toEqual(["sys-1", "sys-2"]);

      // Replace-all: the new set fully supersedes the old (sys-1 removed).
      await service.setSystemLinks({ streamId: STREAM_A, systemIds: ["sys-2", "sys-3"] });
      expect(await sortedLinks(STREAM_A)).toEqual(["sys-2", "sys-3"]);

      // An empty set clears every link.
      await service.setSystemLinks({ streamId: STREAM_A, systemIds: [] });
      expect(await sortedLinks(STREAM_A)).toEqual([]);
    });

    it("getSystemLinksForUpdate returns persisted links; throws NOT_FOUND for an unknown stream", async () => {
      await service.setSystemLinks({ streamId: STREAM_A, systemIds: ["sys-1"] });
      expect(
        (await service.getSystemLinksForUpdate({ streamId: STREAM_A })).systemIds,
      ).toEqual(["sys-1"]);
      // A zero-link stream still resolves (exists, empty set) - only a MISSING
      // stream fails closed.
      expect(
        (await service.getSystemLinksForUpdate({ streamId: STREAM_B })).systemIds,
      ).toEqual([]);
      await expect(
        service.getSystemLinksForUpdate({ streamId: "does-not-exist" }),
      ).rejects.toThrow(/not found/i);
    });

    // The readability gate now lives in the ROUTER's injected authorizer over the
    // ADDED subset. These drive the REAL router (real service + real DB) with a
    // spy authorizer to prove the added-only wiring end to end.
    describe("write path added-only readability gate (router)", () => {
      const MANAGE_RULE = "logstream.stream.manage";
      const teamUser = { type: "user" as const, id: "team-user", accessRules: [] as string[] };
      function grantAuth(grantedIds: string[]): Partial<RpcContext> {
        const granted = new Set(grantedIds);
        return {
          auth: {
            check: mock(async ({ objectId }: { objectId: string }) => ({
              hasAccess: granted.has(objectId),
            })),
            listAccessibleObjectIds: mock(
              async ({ objectIds }: { objectIds: string[] }) =>
                objectIds.filter((id) => granted.has(id)),
            ),
            hasAnyTypeGrant: mock(async () => ({ hasGrant: granted.size > 0 })),
          } as unknown as RpcContext["auth"],
        };
      }
      const managerContext = () =>
        createMockRpcContext({ user: teamUser, ...grantAuth([STREAM_A]) });

      it("authorizes ONLY newly-added systems; a retained (even unreadable) link never blocks", async () => {
        // Seed a set that includes a system the authorizer will REJECT if seen.
        await service.setSystemLinks({
          streamId: STREAM_A,
          systemIds: ["sys-retained-unreadable", "sys-1"],
        });
        const authorize = mock<SystemLinkAuthorizer>(async ({ systemIds }) => {
          if (systemIds.includes("sys-retained-unreadable")) {
            throw new Error("should not be asked about a retained system");
          }
        });
        const router = createLogstreamRouter({
          service,
          authorizeSystemLinks: authorize,
        });
        // Keep the unreadable retained link, keep sys-1, ADD sys-2.
        await call(
          router.setSystemLinks,
          {
            streamId: STREAM_A,
            systemIds: ["sys-retained-unreadable", "sys-1", "sys-2"],
          },
          { context: managerContext() },
        );
        // The authorizer saw ONLY the genuinely-added system.
        expect(authorize).toHaveBeenCalledTimes(1);
        expect(authorize.mock.calls[0]![0]!.systemIds).toEqual(["sys-2"]);
        // The retained-unreadable link is preserved (unrelated edit not blocked).
        expect(await sortedLinks(STREAM_A)).toEqual([
          "sys-1",
          "sys-2",
          "sys-retained-unreadable",
        ]);
      });

      it("unlinking triggers no readability check at all", async () => {
        await service.setSystemLinks({
          streamId: STREAM_A,
          systemIds: ["sys-1", "sys-2"],
        });
        const authorize = mock<SystemLinkAuthorizer>(async () => {});
        const router = createLogstreamRouter({
          service,
          authorizeSystemLinks: authorize,
        });
        await call(
          router.setSystemLinks,
          { streamId: STREAM_A, systemIds: ["sys-1"] },
          { context: managerContext() },
        );
        expect(authorize).not.toHaveBeenCalled();
        expect(await sortedLinks(STREAM_A)).toEqual(["sys-1"]);
      });

      it("a rejection for an added system blocks the write (nothing persisted)", async () => {
        const authorize = mock<SystemLinkAuthorizer>(async () => {
          throw new Error("You can only link systems you can access.");
        });
        const router = createLogstreamRouter({
          service,
          authorizeSystemLinks: authorize,
        });
        await expect(
          call(
            router.setSystemLinks,
            { streamId: STREAM_A, systemIds: ["sys-forbidden"] },
            { context: managerContext() },
          ),
        ).rejects.toThrow(/only link systems you can access/i);
        expect(await sortedLinks(STREAM_A)).toEqual([]);
      });
    });

    it("listStreamsForSystem returns the linked streams by name, joined to existing streams", async () => {
      await service.setSystemLinks({ streamId: STREAM_B, systemIds: ["sys-shared"] });
      await service.setSystemLinks({ streamId: STREAM_A, systemIds: ["sys-shared"] });
      const { streams } = await service.listStreamsForSystem({ systemId: "sys-shared" });
      expect(streams.map((s) => s.name)).toEqual(["Stream A", "Stream B"]);
    });

    it("listLinkedStreamStatuses reports the newest recent SPIKE, ignoring a newer non-signal event", async () => {
      const { db } = test;
      await service.setSystemLinks({ streamId: STREAM_A, systemIds: ["sys-x"] });
      await service.setSystemLinks({ streamId: STREAM_B, systemIds: ["sys-x"] });
      // STREAM_A: a spike at T, then a NEWER new_pattern at T+5min. Without the
      // type filter the newer new_pattern would MASK the spike; the status must
      // still report the spike (the only signal-worthy type).
      const spikeAt = new Date(Date.now() - 10 * 60_000);
      const newerNonSignalAt = new Date(spikeAt.getTime() + 5 * 60_000);
      await db.insert(schema.logImportantEvents).values([
        { id: "ev-spike", streamId: STREAM_A, ts: spikeAt, type: "spike", title: "spike" },
        {
          id: "ev-newer",
          streamId: STREAM_A,
          ts: newerNonSignalAt,
          type: "new_pattern",
          title: "newer non-signal",
        },
        // An OLD spike (outside 24h) must not surface.
        {
          id: "ev-old",
          streamId: STREAM_B,
          ts: new Date(Date.now() - 48 * 3_600_000),
          type: "spike",
          title: "old",
        },
      ]);
      const { matches } = await service.listLinkedStreamStatuses({ systemIds: ["sys-x"] });
      const byId = new Map(matches.map((m) => [m.id, m]));
      expect(byId.get(STREAM_A)!.lastImportantEvent?.type).toBe("spike");
      expect(byId.get(STREAM_A)!.lastImportantEvent?.ts).toEqual(spikeAt);
      expect(byId.get(STREAM_A)!.systemIds).toEqual(["sys-x"]);
      // STREAM_B's only event is an out-of-window spike -> no recent signal.
      expect(byId.get(STREAM_B)!.lastImportantEvent).toBeNull();
    });

    it("listServiceNames dedupes distinct service.name values, newest-biased and capped", async () => {
      const { db } = test;
      // Insert rows carrying resource.service.name, plus rows with none.
      await db.insert(schema.logEvents).values([
        { streamId: STREAM_A, ts: new Date(TS.getTime() + 1000), observedAt: TS, severityNumber: 9, band: "info" as const, body: "a", resource: { "service.name": "checkout-api" } },
        { streamId: STREAM_A, ts: new Date(TS.getTime() + 2000), observedAt: TS, severityNumber: 9, band: "info" as const, body: "b", resource: { "service.name": "checkout-api" } },
        { streamId: STREAM_A, ts: new Date(TS.getTime() + 3000), observedAt: TS, severityNumber: 9, band: "info" as const, body: "c", resource: { "service.name": "payments-api" } },
        { streamId: STREAM_A, ts: new Date(TS.getTime() + 4000), observedAt: TS, severityNumber: 9, band: "info" as const, body: "d", resource: {} },
        { streamId: STREAM_A, ts: new Date(TS.getTime() + 5000), observedAt: TS, severityNumber: 9, band: "info" as const, body: "e", resource: null },
      ]);
      const { serviceNames } = await service.listServiceNames({ streamId: STREAM_A });
      expect([...serviceNames].sort()).toEqual(["checkout-api", "payments-api"]);
    });
  });
});
