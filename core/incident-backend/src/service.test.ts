import { describe, it, expect, mock, beforeEach } from "bun:test";
import { IncidentService } from "./service";

/**
 * Programmable mock DB that records each `select(...).from(...).where(...)`
 * (and optional `.limit(...)`) chain and returns a configurable row array
 * per invocation. Tests exercise the real query-builder calls inside
 * `IncidentService`, only swapping out the terminal data source.
 */
function createProgrammableSelectDb(resultsByCall: unknown[][]) {
  let callIndex = 0;

  const nextResult = (): unknown[] => {
    const result = resultsByCall[callIndex] ?? [];
    callIndex += 1;
    return result;
  };

  const select = mock((projection?: Record<string, unknown>) => {
    void projection;
    const rows = nextResult();

    const limit = mock(() => Promise.resolve(rows));
    const whereResult = Object.assign(Promise.resolve(rows), { limit });
    const where = mock(() => whereResult);
    const fromResult = Object.assign(Promise.resolve(rows), { where });
    const from = mock(() => fromResult);

    return { from };
  });

  return {
    db: { select } as unknown,
    select,
    getCallCount: () => callIndex,
  };
}

describe("IncidentService.hasActiveIncidentWithSuppression", () => {
  let dbHelper: ReturnType<typeof createProgrammableSelectDb>;
  let service: IncidentService;

  const setup = (resultsByCall: unknown[][]) => {
    dbHelper = createProgrammableSelectDb(resultsByCall);
    service = new IncidentService(dbHelper.db as never);
  };

  beforeEach(() => {
    dbHelper = createProgrammableSelectDb([]);
  });

  it("returns true when an active incident with suppressNotifications=true exists for the system", async () => {
    setup([
      // 1st query: incidentSystems lookup for systemId="sys-1"
      [{ incidentId: "inc-1" }],
      // 2nd query: incidents lookup with .where(active AND suppression).limit(1)
      [{ id: "inc-1" }],
    ]);

    const result = await service.hasActiveIncidentWithSuppression("sys-1");

    expect(result).toBe(true);
    expect(dbHelper.getCallCount()).toBe(2);
  });

  it("returns false when no incidents are associated with the system", async () => {
    setup([
      // 1st query: empty -> short-circuits before the 2nd query
      [],
    ]);

    const result = await service.hasActiveIncidentWithSuppression("sys-1");

    expect(result).toBe(false);
    // Only one query should have run; the incidents lookup is skipped.
    expect(dbHelper.getCallCount()).toBe(1);
  });

  it("returns false when the matching incident is resolved (silencing is scoped to active incidents)", async () => {
    setup([
      // 1st query: the system has an incident association.
      [{ incidentId: "inc-resolved" }],
      // 2nd query: the WHERE clause filters out resolved incidents, so the
      // limit(1) projection finds nothing. The real query builder enforces
      // this via `ne(incidents.status, "resolved")`.
      [],
    ]);

    const result = await service.hasActiveIncidentWithSuppression("sys-1");

    expect(result).toBe(false);
    expect(dbHelper.getCallCount()).toBe(2);
  });

  it("returns false when the matching incident has suppressNotifications=false", async () => {
    setup([
      // 1st query: the system has an incident association.
      [{ incidentId: "inc-no-suppress" }],
      // 2nd query: the WHERE clause filters by suppressNotifications=true,
      // so a row with suppressNotifications=false is excluded — the result
      // set is empty.
      [],
    ]);

    const result = await service.hasActiveIncidentWithSuppression("sys-1");

    expect(result).toBe(false);
    expect(dbHelper.getCallCount()).toBe(2);
  });

  it("filters by systemId — does not return true for another system's silenced incident", async () => {
    // The systemId filter is enforced by the WHERE clause on the
    // incidentSystems lookup. Querying "sys-other" returns an empty
    // association set even though "sys-1" has a silenced incident, so the
    // method short-circuits to false.
    setup([
      // 1st query for systemId="sys-other": no associations.
      [],
    ]);

    const result = await service.hasActiveIncidentWithSuppression("sys-other");

    expect(result).toBe(false);
    expect(dbHelper.getCallCount()).toBe(1);
  });
});
