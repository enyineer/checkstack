import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import { sloContract } from "./rpc-contract";

// =============================================================================
// instanceAccess regression guards
// =============================================================================
//
// Grants are keyed as (resourceType="slo.slo", resourceId=objective.id).
// The frontend SloEditor writes grants at the objective level when a
// TeamAccessEditor is present. These tests assert that every proc that targets
// a single objective carries the correct instanceAccess so autoAuthMiddleware
// enforces per-objective team scope.
//
// Pattern: read `proc["~orpc"].meta` — the stable internal accessor used
// across other plugins (see automation-common/src/rpc-contract.test.ts).
// =============================================================================

type ProcMeta = {
  instanceAccess?: {
    idParam?: string;
    listKey?: string;
    recordKey?: string;
    create?: {
      teamIdParam?: string;
      idField?: string;
      parent?: { resourceType?: string; idParam?: string };
    };
    global?: boolean;
    parentScope?: {
      resourceType?: string;
      action?: "read" | "manage";
      idParam?: string;
      recordKey?: string;
    };
  };
  userType?: string;
};

function metaFor(procName: keyof typeof sloContract): ProcMeta {
  const p = sloContract[procName] as unknown as Record<string, unknown>;
  const orpc = p["~orpc"] as { meta?: ProcMeta };
  return orpc.meta ?? {};
}

// ─── Single-objective reads ───────────────────────────────────────────────────

describe("getObjective instanceAccess", () => {
  test("uses idParam 'id' (matches resourceId=objective.id grant key)", () => {
    expect(metaFor("getObjective").instanceAccess).toEqual({ idParam: "id" });
  });
});

// ─── Sub-resource reads scoped by objectiveId ─────────────────────────────────

describe("getDowntimeEvents instanceAccess", () => {
  test("uses idParam 'objectiveId' (matches resourceId=objective.id grant key)", () => {
    expect(metaFor("getDowntimeEvents").instanceAccess).toEqual({
      idParam: "objectiveId",
    });
  });
});

describe("getDailySnapshots instanceAccess", () => {
  test("uses idParam 'objectiveId' (matches resourceId=objective.id grant key)", () => {
    expect(metaFor("getDailySnapshots").instanceAccess).toEqual({
      idParam: "objectiveId",
    });
  });
});

// ─── Create-mode team ownership ───────────────────────────────────────────────

describe("createObjective instanceAccess.create", () => {
  test("carries create config with teamIdParam 'teamId', idField 'id', and a catalog.system parent gate", () => {
    // The parent gate makes SLO creation system-scoped: managing the target
    // system (idParam "systemId") authorizes creating an SLO for it, matching
    // incident/maintenance. Without it, only a slo.slo creator grant or the
    // global rule would allow creation, letting any slo creator target any
    // system.
    expect(metaFor("createObjective").instanceAccess).toEqual({
      create: {
        teamIdParam: "teamId",
        idField: "id",
        parent: { resourceType: "catalog.system", idParam: "systemId" },
      },
    });
  });

  test("idField 'id' matches the top-level id on SloObjectiveSchema output", () => {
    // SloObjectiveSchema has `id: z.string()` at the root — the middleware will
    // read response.id to key the owning-team grant. This test guards against
    // the output being accidentally wrapped (e.g. `{ objective: { id } }`).
    const meta = metaFor("createObjective").instanceAccess?.create;
    expect(meta?.idField).toBe("id");
  });
});

// ─── Mutations targeting a specific objective ─────────────────────────────────

describe("updateObjective instanceAccess", () => {
  test("uses idParam 'id' (UpdateSloObjectiveInputSchema.id)", () => {
    expect(metaFor("updateObjective").instanceAccess).toEqual({ idParam: "id" });
  });
});

describe("deleteObjective instanceAccess", () => {
  test("uses idParam 'id'", () => {
    expect(metaFor("deleteObjective").instanceAccess).toEqual({ idParam: "id" });
  });
});

// ─── Global-scope endpoints (items lack top-level .id / cross-system aggregates) ─

describe("listObjectives instanceAccess", () => {
  test("is global (items lack top-level .id; listKey not applicable)", () => {
    expect(metaFor("listObjectives").instanceAccess).toEqual({ global: true });
  });
});

describe("getStreaks instanceAccess", () => {
  test("is global (SloStreak items have no .id field)", () => {
    expect(metaFor("getStreaks").instanceAccess).toEqual({ global: true });
  });
});

describe("getRecentMilestones instanceAccess", () => {
  test("is global (cross-system aggregate; no systemId input to scope on)", () => {
    expect(metaFor("getRecentMilestones").instanceAccess).toEqual({ global: true });
  });
});

// ─── Parent-scope endpoints keyed by catalog.system ──────────────────────────

describe("getObjectivesForSystem instanceAccess", () => {
  test("uses parentScope catalog.system read scoped by idParam 'systemId'", () => {
    expect(metaFor("getObjectivesForSystem").instanceAccess).toEqual({
      parentScope: { resourceType: "catalog.system", action: "read", idParam: "systemId" },
    });
  });
});

describe("getBulkObjectivesForSystems instanceAccess", () => {
  test("uses parentScope catalog.system read scoped by recordKey 'systems'", () => {
    expect(metaFor("getBulkObjectivesForSystems").instanceAccess).toEqual({
      parentScope: { resourceType: "catalog.system", action: "read", recordKey: "systems" },
    });
  });
});

describe("getAchievements instanceAccess", () => {
  test("uses parentScope catalog.system read scoped by idParam 'systemId'", () => {
    expect(metaFor("getAchievements").instanceAccess).toEqual({
      parentScope: { resourceType: "catalog.system", action: "read", idParam: "systemId" },
    });
  });
});

/**
 * The REST/OpenAPI surface (`/rest/...`) sends query params as strings. With the
 * date params declared as `z.date()` they were unsatisfiable over REST (a string
 * never validates as a native Date), so `getDailySnapshots` 400'd on every REST
 * call. `z.coerce.date()` accepts both an ISO string (REST) and a Date (native
 * RPC), which is what this guards.
 */
function inputSchemaFor(procName: keyof typeof sloContract): ZodType {
  const proc = sloContract[procName] as unknown as Record<string, unknown>;
  const orpc = proc["~orpc"] as { inputSchema?: ZodType };
  if (!orpc.inputSchema) throw new Error(`${String(procName)} has no input`);
  return orpc.inputSchema;
}

describe("getDailySnapshots coerces string date params (REST compatibility)", () => {
  const schema = inputSchemaFor("getDailySnapshots");

  test("accepts ISO date strings (the REST shape)", () => {
    const parsed = schema.safeParse({
      objectiveId: "obj-1",
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-02-01T00:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const data = parsed.data as { startDate: Date; endDate: Date };
      expect(data.startDate).toBeInstanceOf(Date);
      expect(data.endDate).toBeInstanceOf(Date);
    }
  });

  test("still accepts native Date objects (the RPC shape)", () => {
    const parsed = schema.safeParse({
      objectiveId: "obj-1",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-02-01"),
    });
    expect(parsed.success).toBe(true);
  });
});
