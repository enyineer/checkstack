import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  withTestDb,
  isIntegrationEnabled,
  type TestDb,
} from "@checkstack/test-utils-backend";
import * as schema from "../schema";
import {
  upsertVariableBuckets,
  readPatternVariableWindow,
  rollupVariableBuckets,
  deleteExpiredVariableHourly,
} from "./variable-buckets";
import { floorToMinute } from "./time";

const MIGRATIONS = path.join(import.meta.dir, "..", "..", "drizzle");

describe.skipIf(!isIntegrationEnabled())(
  "logstream variable buckets (integration)",
  () => {
    let test: TestDb<typeof schema>;

    beforeAll(async () => {
      test = await withTestDb({ schema, migrationsFolder: MIGRATIONS });
    });
    afterAll(async () => {
      await test.dispose();
    });

    it("folds count/sum on conflict and takes min/max extrema", async () => {
      const runner = test.db;
      const bucketStart = floorToMinute(new Date());
      const base = { streamId: "v1", patternId: "p1", varIndex: 0, bucketStart };

      await upsertVariableBuckets({
        runner,
        deltas: [{ ...base, count: 2, sum: 30, min: 10, max: 20 }],
      });
      await upsertVariableBuckets({
        runner,
        deltas: [{ ...base, count: 3, sum: 12, min: 3, max: 25 }],
      });

      const from = new Date(bucketStart.getTime() - 1);
      const to = new Date(bucketStart.getTime() + 60_000);
      const window = await readPatternVariableWindow({
        runner,
        streamId: "v1",
        patternId: "p1",
        varIndex: 0,
        from,
        to,
        grain: "minute",
      });
      expect(window).toEqual({ sampleCount: 5, sum: 42, min: 3, max: 25 });
    });

    it("returns a null-min/max, zero window when no samples exist", async () => {
      const runner = test.db;
      const window = await readPatternVariableWindow({
        runner,
        streamId: "v-empty",
        patternId: "nope",
        varIndex: 0,
        from: new Date("2020-01-01T00:00:00Z"),
        to: new Date("2020-01-02T00:00:00Z"),
        grain: "minute",
      });
      expect(window).toEqual({ sampleCount: 0, sum: 0, min: null, max: null });
    });

    it("keeps distinct var indexes independent", async () => {
      const runner = test.db;
      const bucketStart = floorToMinute(new Date("2026-06-01T10:00:00Z"));
      await upsertVariableBuckets({
        runner,
        deltas: [
          { streamId: "v2", patternId: "p", varIndex: 0, bucketStart, count: 1, sum: 5, min: 5, max: 5 },
          { streamId: "v2", patternId: "p", varIndex: 1, bucketStart, count: 1, sum: 9, min: 9, max: 9 },
        ],
      });
      const from = new Date(bucketStart.getTime() - 1);
      const to = new Date(bucketStart.getTime() + 60_000);
      const v0 = await readPatternVariableWindow({
        runner, streamId: "v2", patternId: "p", varIndex: 0, from, to, grain: "minute",
      });
      const v1 = await readPatternVariableWindow({
        runner, streamId: "v2", patternId: "p", varIndex: 1, from, to, grain: "minute",
      });
      expect(v0.sum).toBe(5);
      expect(v1.sum).toBe(9);
    });

    it("rolls minute buckets into hourly, then hourly cleanup deletes them", async () => {
      const db = test.db;
      // Two minutes within the same hour, well in the past so they are stale.
      const m1 = floorToMinute(new Date("2026-01-01T10:05:00Z"));
      const m2 = floorToMinute(new Date("2026-01-01T10:40:00Z"));
      await upsertVariableBuckets({
        runner: db,
        deltas: [
          { streamId: "v3", patternId: "p", varIndex: 0, bucketStart: m1, count: 2, sum: 20, min: 8, max: 12 },
          { streamId: "v3", patternId: "p", varIndex: 0, bucketStart: m2, count: 3, sum: 15, min: 2, max: 9 },
        ],
      });

      await rollupVariableBuckets({
        db,
        streamId: "v3",
        minuteCutoff: new Date("2026-01-02T00:00:00Z"),
      });

      // Minute rows are gone; the hourly window carries the folded stats.
      const minuteLeft = await db
        .select()
        .from(schema.logPatternVariableBuckets)
        .where(eq(schema.logPatternVariableBuckets.streamId, "v3"));
      expect(minuteLeft).toHaveLength(0);

      const hourWindow = await readPatternVariableWindow({
        runner: db,
        streamId: "v3",
        patternId: "p",
        varIndex: 0,
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-01-02T00:00:00Z"),
        grain: "hour",
      });
      expect(hourWindow).toEqual({ sampleCount: 5, sum: 35, min: 2, max: 12 });

      await deleteExpiredVariableHourly({
        db,
        streamId: "v3",
        hourlyCutoff: new Date("2026-02-01T00:00:00Z"),
      });
      const hourLeft = await db
        .select()
        .from(schema.logPatternVariableHourly)
        .where(eq(schema.logPatternVariableHourly.streamId, "v3"));
      expect(hourLeft).toHaveLength(0);
    });
  },
);
