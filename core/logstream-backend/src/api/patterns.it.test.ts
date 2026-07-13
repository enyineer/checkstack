import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { EventBus, Logger } from "@checkstack/backend-api";
import {
  withTestDb,
  isIntegrationEnabled,
  type TestDb,
} from "@checkstack/test-utils-backend";
import { DEFAULT_LOG_STREAM_CONFIG } from "@checkstack/logstream-common";
import * as schema from "../schema";
import { floorToMinute, floorToHour } from "../storage";
import { createStorage } from "../storage";
import {
  createPatternOperations,
  computeUserPatternId,
  MAX_USER_PATTERNS_PER_STREAM,
  type PatternOperations,
} from "./patterns";
import type { FindReferencingChecks } from "../health/pattern-references";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");
const STREAM = "stream-patterns-it";
const CREATED = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-06-10T00:00:00.000Z");

const noopLogger: Logger = {
  info() {},
  error() {},
  warn() {},
  debug() {},
};

describe.skipIf(!isIntegrationEnabled())("logstream patterns (integration)", () => {
  let test: TestDb<typeof schema>;

  const buildOps = (
    findReferencingChecks: FindReferencingChecks = async () => [],
    eventBus?: EventBus,
  ): PatternOperations =>
    createPatternOperations({
      db: test.db,
      eventBus,
      logger: noopLogger,
      findReferencingChecks,
      now: () => NOW,
    });

  /** A minimal EventBus that records the payloads `createPattern` emits. */
  const capturingEventBus = (): { bus: EventBus; emitted: unknown[] } => {
    const emitted: unknown[] = [];
    const bus: EventBus = {
      async subscribe() {
        return async () => {};
      },
      async emit(_hook, payload) {
        emitted.push(payload);
      },
      async emitLocal(_hook, payload) {
        emitted.push(payload);
      },
      async shutdown() {},
    };
    return { bus, emitted };
  };

  beforeAll(async () => {
    test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
  });
  afterAll(async () => {
    await test.dispose();
  });

  beforeEach(async () => {
    const { db } = test;
    await db.delete(schema.logPatternVariableBuckets);
    await db.delete(schema.logPatternVariableHourly);
    await db.delete(schema.logPatternBuckets);
    await db.delete(schema.logPatternHourly);
    await db.delete(schema.logPatterns);
    await db.delete(schema.logEvents);
    await db.delete(schema.logStreams);
    await db.insert(schema.logStreams).values({
      id: STREAM,
      name: "Patterns IT",
      config: DEFAULT_LOG_STREAM_CONFIG,
      createdAt: CREATED,
      updatedAt: CREATED,
    });
  });

  describe("createPattern", () => {
    it("inserts a user pattern with the drain-consistent id", async () => {
      const result = await buildOps().createPattern({
        streamId: STREAM,
        template: "user logged in <*>",
      });
      expect(result.id).toBe(
        computeUserPatternId({ streamId: STREAM, template: "user logged in <*>" }),
      );
      expect(result.origin).toBe("user");
      expect(result.tokenCount).toBe(4);

      const rows = await test.db.select().from(schema.logPatterns);
      expect(rows).toHaveLength(1);
      expect(rows[0].origin).toBe("user");
    });

    it("rejects an all-wildcard template", async () => {
      await expect(
        buildOps().createPattern({ streamId: STREAM, template: "<*> <*>" }),
      ).rejects.toThrow(/at least one literal token/i);
    });

    it("409s on a duplicate USER template (does not clobber the existing row)", async () => {
      await buildOps().createPattern({ streamId: STREAM, template: "dup <*>" });
      await expect(
        buildOps().createPattern({ streamId: STREAM, template: "dup <*>" }),
      ).rejects.toThrow(/already exists/i);
      expect(await test.db.select().from(schema.logPatterns)).toHaveLength(1);
    });

    it("PROMOTES a mined pattern with the same template instead of 409ing", async () => {
      const template = "cache miss key <*>";
      const id = computeUserPatternId({ streamId: STREAM, template });
      const minedFirstSeen = new Date("2026-05-01T00:00:00.000Z");
      const minedLastSeen = new Date("2026-06-05T12:00:00.000Z");
      // A row Drain already mined for this exact template, with real counts.
      await test.db.insert(schema.logPatterns).values({
        id,
        streamId: STREAM,
        template,
        tokenCount: 4,
        firstSeenAt: minedFirstSeen,
        lastSeenAt: minedLastSeen,
        sampleBody: "cache miss key item:42",
        totalCount: 137,
        severityMax: 9,
        origin: "mined",
      });

      const { bus, emitted } = capturingEventBus();
      const promoted = await buildOps(undefined, bus).createPattern({
        streamId: STREAM,
        template,
      });

      // Same id, origin flips to user, counts + first/last-seen preserved.
      expect(promoted.id).toBe(id);
      expect(promoted.origin).toBe("user");
      expect(promoted.totalCount).toBe(137);
      expect(promoted.firstSeenAt).toEqual(minedFirstSeen);
      expect(promoted.lastSeenAt).toEqual(minedLastSeen);

      const rows = await test.db.select().from(schema.logPatterns);
      expect(rows).toHaveLength(1);
      expect(rows[0].origin).toBe("user");
      expect(Number(rows[0].totalCount)).toBe(137);

      // The pods are told to re-pin the (now protected) cluster.
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        streamId: STREAM,
        patternId: id,
        action: "upserted",
      });
    });

    it("still 409s when the same template is ALREADY a user pattern (not promote)", async () => {
      const template = "already user <*>";
      await buildOps().createPattern({ streamId: STREAM, template });
      await expect(
        buildOps().createPattern({ streamId: STREAM, template }),
      ).rejects.toThrow(/already exists/i);
    });

    it("rejects a create past MAX_USER_PATTERNS_PER_STREAM with an actionable message", async () => {
      // Seed exactly the cap of user patterns directly (fast), then the next
      // create must be refused; a create AT the boundary (cap - 1 -> cap) is fine.
      await seedUserPatterns(MAX_USER_PATTERNS_PER_STREAM - 1);
      // The (cap)-th create succeeds.
      await buildOps().createPattern({
        streamId: STREAM,
        template: "boundary pattern <*>",
      });
      expect(await test.db.select().from(schema.logPatterns)).toHaveLength(
        MAX_USER_PATTERNS_PER_STREAM,
      );
      // The (cap + 1)-th is refused with a friendly, actionable message.
      await expect(
        buildOps().createPattern({
          streamId: STREAM,
          template: "one too many <*>",
        }),
      ).rejects.toThrow(/maximum of 200 custom patterns/i);
      // Nothing was inserted past the cap.
      expect(await test.db.select().from(schema.logPatterns)).toHaveLength(
        MAX_USER_PATTERNS_PER_STREAM,
      );
    });

    it("does NOT count mined patterns toward the user cap", async () => {
      // Fill the cap with USER patterns, plus a mined one; a NEW user template
      // is still refused, and promoting the mined one is refused too (both would
      // exceed the protected budget).
      await seedUserPatterns(MAX_USER_PATTERNS_PER_STREAM);
      const minedTemplate = "mined at cap <*>";
      await test.db.insert(schema.logPatterns).values({
        id: computeUserPatternId({ streamId: STREAM, template: minedTemplate }),
        streamId: STREAM,
        template: minedTemplate,
        tokenCount: 4,
        firstSeenAt: CREATED,
        lastSeenAt: CREATED,
        sampleBody: "mined at cap 1",
        origin: "mined",
      });
      // Promotion would push the protected set to cap + 1 -> refused.
      await expect(
        buildOps().createPattern({ streamId: STREAM, template: minedTemplate }),
      ).rejects.toThrow(/maximum of 200 custom patterns/i);
      // The mined row is untouched (still mined).
      const [mined] = await test.db
        .select()
        .from(schema.logPatterns)
        .where(eq(schema.logPatterns.template, minedTemplate));
      expect(mined.origin).toBe("mined");
    });
  });

  /** Bulk-insert `count` distinct user patterns (fast cap-test fixture). */
  async function seedUserPatterns(count: number): Promise<void> {
    const rows = Array.from({ length: count }, (_, i) => {
      const template = `seeded user pattern ${i} <*>`;
      return {
        id: computeUserPatternId({ streamId: STREAM, template }),
        streamId: STREAM,
        template,
        tokenCount: 5,
        firstSeenAt: CREATED,
        lastSeenAt: CREATED,
        sampleBody: `seeded ${i}`,
        origin: "user" as const,
      };
    });
    await test.db.insert(schema.logPatterns).values(rows);
  }

  describe("deletePattern", () => {
    it("deletes a user pattern", async () => {
      const created = await buildOps().createPattern({
        streamId: STREAM,
        template: "del <*>",
      });
      await buildOps().deletePattern({
        streamId: STREAM,
        patternId: created.id,
      });
      expect(await test.db.select().from(schema.logPatterns)).toHaveLength(0);
    });

    it("refuses to delete a mined pattern (BAD_REQUEST)", async () => {
      await test.db.insert(schema.logPatterns).values({
        id: "mined-1",
        streamId: STREAM,
        template: "mined <*>",
        tokenCount: 2,
        firstSeenAt: CREATED,
        lastSeenAt: CREATED,
        sampleBody: "mined 1",
        origin: "mined",
      });
      await expect(
        buildOps().deletePattern({ streamId: STREAM, patternId: "mined-1" }),
      ).rejects.toThrow(/user-authored/i);
      expect(await test.db.select().from(schema.logPatterns)).toHaveLength(1);
    });

    it("409s (naming the checks) when a user pattern is referenced by a check", async () => {
      const created = await buildOps().createPattern({
        streamId: STREAM,
        template: "ref <*>",
      });
      const ops = buildOps(async () => ["Payments error rate"]);
      await expect(
        ops.deletePattern({ streamId: STREAM, patternId: created.id }),
      ).rejects.toThrow(/Payments error rate/);
      // Still present: the delete was refused.
      expect(await test.db.select().from(schema.logPatterns)).toHaveLength(1);
    });
  });

  describe("testPattern", () => {
    it("counts matches against the newest raw lines (mask-consistent)", async () => {
      await test.db.insert(schema.logEvents).values([
        mkEvent("user logged in 42", "2026-06-09T10:00:00.000Z"),
        mkEvent("user logged in 7", "2026-06-09T10:00:01.000Z"),
        mkEvent("admin logged out", "2026-06-09T10:00:02.000Z"),
      ]);
      const result = await buildOps().testPattern({
        streamId: STREAM,
        template: "user logged in <*>",
        sampleLimit: 100,
      });
      expect(result.matchCount).toBe(2);
      expect(result.samples).toHaveLength(2);
      expect(result.samples.every((s) => s.body.startsWith("user logged in"))).toBe(
        true,
      );
    });
  });

  describe("maskLine", () => {
    it("masks a raw line into the drain template space", async () => {
      const result = await buildOps().maskLine({
        streamId: STREAM,
        body: "user 12 logged in from 10.0.0.1",
      });
      // Numbers and the IPv4 collapse to <*>; literals survive.
      expect(result.template).toBe("user <*> logged in from <*>");
    });

    it("round-trips: maskLine -> createPattern -> testPattern matches the same line", async () => {
      const raw = "order 8891 shipped to zone 3";
      const { template } = await buildOps().maskLine({
        streamId: STREAM,
        body: raw,
      });
      await buildOps().createPattern({ streamId: STREAM, template });
      await test.db
        .insert(schema.logEvents)
        .values(mkEvent(raw, "2026-06-09T10:00:00.000Z"));

      const result = await buildOps().testPattern({
        streamId: STREAM,
        template,
        sampleLimit: 100,
      });
      // The masked template the builder seeded from the line matches that line.
      expect(result.matchCount).toBe(1);
      expect(result.samples[0]?.body).toBe(raw);
    });
  });

  describe("listPatternVariables", () => {
    it("summarizes each wildcard position from the variable buckets", async () => {
      const storage = createStorage({ db: test.db });
      const patternId = "p-var";
      await test.db.insert(schema.logPatterns).values({
        id: patternId,
        streamId: STREAM,
        template: "latency <*> ms path <*>",
        tokenCount: 5,
        firstSeenAt: CREATED,
        lastSeenAt: NOW,
        sampleBody: "latency 12 ms path /a",
        origin: "user",
      });
      const bucket = floorToMinute(new Date("2026-06-09T23:00:00.000Z"));
      // varIndex 0 (latency) is numeric; varIndex 1 (path) has NO numeric buckets.
      await storage.upsertVariableBuckets({
        runner: test.db,
        deltas: [
          {
            streamId: STREAM,
            patternId,
            varIndex: 0,
            bucketStart: bucket,
            count: 4,
            sum: 120,
            min: 10,
            max: 50,
          },
        ],
      });
      // 8 total occurrences of the pattern in the window (numericShare = 4/8).
      await test.db.insert(schema.logPatternBuckets).values({
        streamId: STREAM,
        bucketStart: bucket,
        patternId,
        count: 8,
      });

      const { variables } = await buildOps().listPatternVariables({
        streamId: STREAM,
        patternId,
      });
      expect(variables).toHaveLength(2);
      const v0 = variables.find((v) => v.varIndex === 0)!;
      expect(v0.numericShare).toBe(0.5);
      expect(v0.sampleValues).toEqual(["10", "30", "50"]);
      const v1 = variables.find((v) => v.varIndex === 1)!;
      expect(v1.sampleValues).toEqual([]);
      expect(v1.numericShare).toBe(0);
    });

    it("returns no variables for an unknown pattern", async () => {
      const { variables } = await buildOps().listPatternVariables({
        streamId: STREAM,
        patternId: "nope",
      });
      expect(variables).toEqual([]);
    });

    it("merges the HOURLY tier so patterns quiet past minute retention keep sample hints", async () => {
      const patternId = "p-hourly";
      await test.db.insert(schema.logPatterns).values({
        id: patternId,
        streamId: STREAM,
        template: "latency <*> ms",
        tokenCount: 4,
        firstSeenAt: CREATED,
        lastSeenAt: NOW,
        sampleBody: "latency 12 ms",
        origin: "user",
      });
      // Within the 24h window but ONLY in the hourly tier (its minute buckets
      // already rolled up), so a minute-only read would report zero samples.
      const hour = floorToHour(new Date("2026-06-09T05:00:00.000Z"));
      await test.db.insert(schema.logPatternVariableHourly).values({
        streamId: STREAM,
        patternId,
        varIndex: 0,
        bucketStart: hour,
        count: 4,
        sum: 120,
        min: 10,
        max: 50,
      });
      await test.db.insert(schema.logPatternHourly).values({
        streamId: STREAM,
        bucketStart: hour,
        patternId,
        count: 8,
      });

      const { variables } = await buildOps().listPatternVariables({
        streamId: STREAM,
        patternId,
      });
      expect(variables).toHaveLength(1);
      const v0 = variables[0];
      // 4 numeric samples out of 8 hourly occurrences; min/mean/max from hourly.
      expect(v0.numericShare).toBe(0.5);
      expect(v0.sampleValues).toEqual(["10", "30", "50"]);
    });

    it("sums the minute AND hourly tiers for one variable position", async () => {
      const storage = createStorage({ db: test.db });
      const patternId = "p-both-tiers";
      await test.db.insert(schema.logPatterns).values({
        id: patternId,
        streamId: STREAM,
        template: "took <*> ms",
        tokenCount: 4,
        firstSeenAt: CREATED,
        lastSeenAt: NOW,
        sampleBody: "took 5 ms",
        origin: "user",
      });
      const minute = floorToMinute(new Date("2026-06-09T23:30:00.000Z"));
      const hour = floorToHour(new Date("2026-06-09T05:00:00.000Z"));
      await storage.upsertVariableBuckets({
        runner: test.db,
        deltas: [
          {
            streamId: STREAM,
            patternId,
            varIndex: 0,
            bucketStart: minute,
            count: 2,
            sum: 30,
            min: 10,
            max: 20,
          },
        ],
      });
      await test.db.insert(schema.logPatternVariableHourly).values({
        streamId: STREAM,
        patternId,
        varIndex: 0,
        bucketStart: hour,
        count: 2,
        sum: 110,
        min: 5,
        max: 60,
      });
      // Pattern totals across both tiers: 4 (minute) + 6 (hourly) = 10.
      await test.db.insert(schema.logPatternBuckets).values({
        streamId: STREAM,
        bucketStart: minute,
        patternId,
        count: 4,
      });
      await test.db.insert(schema.logPatternHourly).values({
        streamId: STREAM,
        bucketStart: hour,
        patternId,
        count: 6,
      });

      const { variables } = await buildOps().listPatternVariables({
        streamId: STREAM,
        patternId,
      });
      expect(variables).toHaveLength(1);
      const v0 = variables[0];
      // Merged: count 4, sum 140 -> mean 35; min 5, max 60; share 4/10 = 0.4.
      expect(v0.numericShare).toBe(0.4);
      expect(v0.sampleValues).toEqual(["5", "35", "60"]);
    });
  });
});

function mkEvent(body: string, ts: string) {
  return {
    streamId: STREAM,
    ts: new Date(ts),
    observedAt: new Date(ts),
    severityNumber: 9,
    band: "info" as const,
    body,
  };
}
