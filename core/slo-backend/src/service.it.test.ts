/**
 * Integration test (real Postgres) for the SloService query layer.
 *
 * These pin the SQL whose CORRECTNESS is the risk, not the surrounding branch
 * logic: the `getDowntimeForWindow` overlap predicate (which rows reach the
 * pure window aggregator) and the attribution-scoped open-event filters.
 * `createMockDb()` returns canned empty results, so it can only prove the
 * caller's branch logic - it cannot prove the WHERE clause selects the right
 * rows. The pure clamp math itself is covered by `downtime-window.test.ts`;
 * this suite covers the SELECT that feeds it.
 *
 * Gated behind `CHECKSTACK_IT=1` (via `isIntegrationEnabled()`), so the default
 * `bun test` lane skips the whole suite. The `integration` CI job sets the flag
 * and provides a Postgres service container; the connection comes from
 * `CHECKSTACK_IT_PG_URL`. See `core/test-utils-backend/src/with-test-db.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  isIntegrationEnabled,
  withTestDb,
  type TestDb,
} from "@checkstack/test-utils-backend";
import { CreateSloObjectiveInputSchema } from "@checkstack/slo-common";
import * as schema from "./schema";
import { sloDowntimeEvents } from "./schema";
import { SloService } from "./service";

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

/** A fixed window so overlap assertions are deterministic. */
const WINDOW_START = new Date("2026-01-10T00:00:00.000Z");
const WINDOW_END = new Date("2026-01-20T00:00:00.000Z");
const MINUTE = 60_000;

describe.skipIf(!isIntegrationEnabled())("SloService (real Postgres)", () => {
  let testDb: TestDb<typeof schema>;
  let service: SloService;

  beforeAll(async () => {
    testDb = await withTestDb({ schema, migrationsFolder });
    service = new SloService(testDb.db);
  });

  afterAll(async () => {
    await testDb.dispose();
  });

  /** Create an objective (and its 1:1 streak) for a fresh system. */
  async function seedObjective(systemId: string): Promise<string> {
    // Parse through the schema so the defaulted fields (dependencyExclusion,
    // excludedDependencyIds, burnRateThresholds) are populated.
    const input = CreateSloObjectiveInputSchema.parse({
      systemId,
      target: 99.9,
      windowDays: 30,
    });
    const objective = await service.createObjective({ input });
    return objective.id;
  }

  describe("getDowntimeForWindow (overlap predicate)", () => {
    it("includes a closed event that began before the window but overlaps it", async () => {
      const objectiveId = await seedObjective(`sys-${crypto.randomUUID()}`);

      // 60 minutes of downtime, but only the 30 minutes from WINDOW_START fall
      // inside the window (it began 30 min before the window opened).
      await testDb.db.insert(sloDowntimeEvents).values({
        id: crypto.randomUUID(),
        objectiveId,
        systemId: "ignored",
        startTime: new Date(WINDOW_START.getTime() - 30 * MINUTE),
        endTime: new Date(WINDOW_START.getTime() + 30 * MINUTE),
        attributionType: "self",
      });

      const result = await service.getDowntimeForWindow({
        objectiveId,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        includeOpen: false,
      });

      // Only the in-window 30 minutes are counted, not the full 60.
      expect(result.totalMinutes).toBeCloseTo(30, 5);
      expect(result.selfMinutes).toBeCloseTo(30, 5);
      expect(result.upstreamMinutes).toBe(0);
    });

    it("excludes a closed event entirely outside the window", async () => {
      const objectiveId = await seedObjective(`sys-${crypto.randomUUID()}`);

      // Ends before the window starts: the overlap predicate must drop it.
      await testDb.db.insert(sloDowntimeEvents).values({
        id: crypto.randomUUID(),
        objectiveId,
        systemId: "ignored",
        startTime: new Date(WINDOW_START.getTime() - 120 * MINUTE),
        endTime: new Date(WINDOW_START.getTime() - 60 * MINUTE),
        attributionType: "self",
      });

      const result = await service.getDowntimeForWindow({
        objectiveId,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        includeOpen: false,
      });

      expect(result.totalMinutes).toBe(0);
      expect(result.entries).toHaveLength(0);
    });

    it("counts open events only when includeOpen is true", async () => {
      const objectiveId = await seedObjective(`sys-${crypto.randomUUID()}`);

      // Open event (no endTime) that started inside the window.
      await testDb.db.insert(sloDowntimeEvents).values({
        id: crypto.randomUUID(),
        objectiveId,
        systemId: "ignored",
        startTime: new Date(WINDOW_START.getTime() + 60 * MINUTE),
        endTime: null,
        attributionType: "self",
      });

      const excluded = await service.getDowntimeForWindow({
        objectiveId,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        includeOpen: false,
      });
      // The open row is filtered out of the SQL entirely when includeOpen=false.
      expect(excluded.totalMinutes).toBe(0);

      const included = await service.getDowntimeForWindow({
        objectiveId,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        includeOpen: true,
      });
      // With includeOpen=true the open row is selected and clamped to the window.
      expect(included.totalMinutes).toBeGreaterThan(0);
      expect(included.selfMinutes).toBe(included.totalMinutes);
    });

    it("scopes by objectiveId so another objective's downtime never leaks in", async () => {
      const objectiveA = await seedObjective(`sys-${crypto.randomUUID()}`);
      const objectiveB = await seedObjective(`sys-${crypto.randomUUID()}`);

      await testDb.db.insert(sloDowntimeEvents).values({
        id: crypto.randomUUID(),
        objectiveId: objectiveB,
        systemId: "ignored",
        startTime: new Date(WINDOW_START.getTime() + MINUTE),
        endTime: new Date(WINDOW_START.getTime() + 11 * MINUTE),
        attributionType: "self",
      });

      const result = await service.getDowntimeForWindow({
        objectiveId: objectiveA,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        includeOpen: false,
      });

      expect(result.totalMinutes).toBe(0);
    });
  });

  describe("open-event attribution scoping", () => {
    it("getOpenSelfEvents and getOpenUpstreamEvents partition by attribution", async () => {
      const systemId = `sys-${crypto.randomUUID()}`;
      const objectiveId = await seedObjective(systemId);
      const upstreamSystemId = `upstream-${crypto.randomUUID()}`;

      const selfEvent = await service.openDowntimeEvent({
        objectiveId,
        systemId,
        attributionType: "self",
      });
      const upstreamEvent = await service.openDowntimeEvent({
        objectiveId,
        systemId,
        attributionType: "upstream",
        upstreamSystemId,
        upstreamSystemName: "Payments",
      });

      const selfEvents = await service.getOpenSelfEvents({ systemId });
      expect(selfEvents.map((e) => e.id)).toEqual([selfEvent.id]);

      const upstreamEvents = await service.getOpenUpstreamEvents({
        systemId,
        upstreamSystemId,
      });
      expect(upstreamEvents.map((e) => e.id)).toEqual([upstreamEvent.id]);

      // A different upstream system id matches nothing.
      const none = await service.getOpenUpstreamEvents({
        systemId,
        upstreamSystemId: `other-${crypto.randomUUID()}`,
      });
      expect(none).toHaveLength(0);

      // Closing the self event removes it from the open-self filter.
      await service.closeDowntimeEvent({ id: selfEvent.id });
      const afterClose = await service.getOpenSelfEvents({ systemId });
      expect(afterClose).toHaveLength(0);
    });
  });
});
