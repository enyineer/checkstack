import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import path from "node:path";
import {
  withTestDb,
  isIntegrationEnabled,
  createMockLogger,
  type TestDb,
} from "@checkstack/test-utils-backend";
import type { CacheManager, CacheProvider } from "@checkstack/cache-api";
import { DEFAULT_LOG_STREAM_CONFIG } from "@checkstack/logstream-common";
import type { EventCursor } from "@checkstack/logstream-common";
import * as schema from "../schema";
import { createStorage } from "../storage";
import { createLogstreamService, type LogstreamService } from "./service";

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
});
