import { describe, test, expect, mock } from "bun:test";
import { AnomalyService } from "./service";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "./schema";

/**
 * Read-side guards for the per-(check, environment) anomaly split. `getAnomalies`
 * gains an `environmentId` tristate filter (mirroring `getAnomalyBaselines`), and
 * `getActiveSignalAnomalies` surfaces `environmentId` so the dashboard signal
 * aggregator can disambiguate two envs of the same field. These tests assert the
 * DB-layer predicate (via the drizzle SQL chunks) and the projected row shape
 * without a live database.
 */

/** Flatten a drizzle SQL condition into a readable string. */
function serializeCondition(cond: unknown): string {
  if (cond === null || cond === undefined || typeof cond !== "object") {
    return String(cond);
  }
  const c = cond as Record<string, unknown>;
  if (Array.isArray(c.queryChunks)) {
    return c.queryChunks.map(serializeCondition).join("");
  }
  if (Array.isArray(c.value)) {
    return (c.value as unknown[]).join("");
  }
  if (typeof c.name === "string") return c.name;
  if ("value" in c) return String(c.value);
  return "";
}

function createGetAnomaliesMockDb({
  rows = [],
  onWhere,
}: {
  rows?: unknown[];
  onWhere?: (condition: unknown) => void;
} = {}): SafeDatabase<typeof schema> {
  // getAnomalies chain: select().from().where().orderBy().limit()
  const db = {
    select: mock(() => ({
      from: mock(() => ({
        where: mock((condition: unknown) => {
          onWhere?.(condition);
          return {
            orderBy: mock(() => ({
              limit: mock(() => Promise.resolve(rows)),
            })),
          };
        }),
      })),
    })),
  };
  return db as unknown as SafeDatabase<typeof schema>;
}

const anomalyRow = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  systemId: "sys-1",
  configurationId: "cfg-1",
  environmentId: null,
  fieldPath: "collectors.http.request.responseTimeMs",
  kind: "spike" as const,
  state: "anomaly" as const,
  direction: "above" as const,
  baselineValue: 100,
  baselineStdDev: 10,
  observedValue: "200",
  deviation: 10,
  suspiciousRunCount: 3,
  confirmationThreshold: 3,
  startedAt: new Date("2026-06-07T10:00:00.000Z"),
  confirmedAt: new Date("2026-06-07T10:05:00.000Z"),
  recoveredAt: null,
  suppressedAt: null,
  suppressedValue: null,
  suppressedBaseline: null,
  metadata: null,
  ...over,
});

describe("AnomalyService.getAnomalies environment filter", () => {
  test("environmentId: string filters via eq(environment_id, X)", async () => {
    let captured: unknown;
    const service = new AnomalyService(
      createGetAnomaliesMockDb({ onWhere: (c) => (captured = c) }),
    );
    await service.getAnomalies({ systemId: "sys-1", environmentId: "env-prod" });
    const where = serializeCondition(captured);
    expect(where).toContain("environment_id = env-prod");
  });

  test("environmentId: null filters via IS NULL", async () => {
    let captured: unknown;
    const service = new AnomalyService(
      createGetAnomaliesMockDb({ onWhere: (c) => (captured = c) }),
    );
    await service.getAnomalies({ systemId: "sys-1", environmentId: null });
    const where = serializeCondition(captured);
    expect(where).toContain("environment_id is null");
    expect(where).not.toContain("environment_id =");
  });

  test("environmentId: undefined applies no env predicate (all envs)", async () => {
    let captured: unknown;
    const service = new AnomalyService(
      createGetAnomaliesMockDb({ onWhere: (c) => (captured = c) }),
    );
    await service.getAnomalies({ systemId: "sys-1" });
    const where = serializeCondition(captured);
    expect(where).not.toContain("environment_id");
  });

  test("surfaces environmentId on each returned DTO", async () => {
    const service = new AnomalyService(
      createGetAnomaliesMockDb({
        rows: [anomalyRow({ environmentId: "env-prod" })],
      }),
    );
    const [dto] = await service.getAnomalies({ systemId: "sys-1" });
    expect(dto?.environmentId).toBe("env-prod");
  });
});

describe("AnomalyService.getActiveSignalAnomalies", () => {
  test("projects environmentId onto each signal row", async () => {
    // getActiveSignalAnomalies chain: select({...}).from().where().orderBy()
    const rows = [
      {
        systemId: "sys-1",
        configurationId: "cfg-1",
        environmentId: "env-prod",
        fieldPath: "latency",
        startedAt: new Date("2026-06-07T10:00:00.000Z"),
        state: "anomaly" as const,
      },
    ];
    const db = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            orderBy: mock(() => Promise.resolve(rows)),
          })),
        })),
      })),
    } as unknown as SafeDatabase<typeof schema>;

    const service = new AnomalyService(db);
    const result = await service.getActiveSignalAnomalies();
    expect(result[0]?.environmentId).toBe("env-prod");
    expect(result[0]?.startedAt).toBe("2026-06-07T10:00:00.000Z");
  });
});
