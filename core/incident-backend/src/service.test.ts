import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { AdvisoryLockService } from "@checkstack/backend-api";
import { IncidentService } from "./service";
import {
  incidents,
  incidentSystems,
  incidentUpdates,
  incidentLinks,
} from "./schema";

/**
 * In-memory {@link AdvisoryLockService} that faithfully serializes
 * `withXactLock` calls per key (a racing call on the same key cannot run its
 * `fn` until the prior call's `fn` settles) — modelling `pg_advisory_xact_lock`
 * without a real connection. Different keys are independent.
 */
function makeFakeAdvisoryLock(): AdvisoryLockService {
  const tails = new Map<string, Promise<unknown>>();
  return {
    tryAcquire: async () => ({ release: async () => {} }),
    withXactLock<T>({
      key,
      fn,
    }: {
      key: string;
      fn: () => Promise<T>;
    }): Promise<T> {
      const prior = tails.get(key) ?? Promise.resolve();
      const result = prior.then(
        () => fn(),
        () => fn(),
      );
      tails.set(
        key,
        result.then(
          () => undefined,
          () => undefined,
        ),
      );
      return result;
    },
  };
}

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

  // Read-batching methods (getManyEntityStates, listOpenIncidentsBySystem, ...)
  // now run their reads inside `withScopedTransaction` -> `db.transaction(fn)`.
  // The tx exposes the SAME `select` mock so the per-invocation call counter is
  // shared and `getCallCount()` still reflects total queries issued.
  const transaction = mock((fn: (tx: { select: typeof select }) => unknown) =>
    Promise.resolve(fn({ select })),
  );

  return {
    db: { select, transaction } as unknown,
    select,
    getCallCount: () => callIndex,
  };
}

describe("IncidentService.hasActiveIncidentWithSuppression", () => {
  let dbHelper: ReturnType<typeof createProgrammableSelectDb>;
  let service: IncidentService;

  const setup = (resultsByCall: unknown[][]) => {
    dbHelper = createProgrammableSelectDb(resultsByCall);
    service = new IncidentService(dbHelper.db as never, makeFakeAdvisoryLock());
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

describe("IncidentService.getManyEntityStates (plugin-backed entity read)", () => {
  it("returns {} for an empty id set without querying", async () => {
    const dbHelper = createProgrammableSelectDb([]);
    const service = new IncidentService(dbHelper.db as never, makeFakeAdvisoryLock());
    expect(await service.getManyEntityStates([])).toEqual({});
    expect(dbHelper.getCallCount()).toBe(0);
  });

  it("projects { status, severity, systemIds } from incidents + junction", async () => {
    const dbHelper = createProgrammableSelectDb([
      // 1st query: incidents rows for the requested ids.
      [
        { id: "inc-1", status: "investigating", severity: "major" },
        { id: "inc-2", status: "resolved", severity: "minor" },
      ],
      // 2nd query: incident_systems junction rows for the present ids.
      [
        { incidentId: "inc-1", systemId: "sys-a" },
        { incidentId: "inc-1", systemId: "sys-b" },
        { incidentId: "inc-2", systemId: "sys-c" },
      ],
    ]);
    const service = new IncidentService(dbHelper.db as never, makeFakeAdvisoryLock());
    const out = await service.getManyEntityStates(["inc-1", "inc-2", "inc-x"]);
    expect(out).toEqual({
      "inc-1": {
        status: "investigating",
        severity: "major",
        systemIds: ["sys-a", "sys-b"],
      },
      "inc-2": { status: "resolved", severity: "minor", systemIds: ["sys-c"] },
    });
    // Missing ids are omitted (never a null/undefined entry).
    expect("inc-x" in out).toBe(false);
  });

  it("returns {} when none of the ids exist (no junction query)", async () => {
    const dbHelper = createProgrammableSelectDb([
      // incidents query returns nothing → no second query.
      [],
    ]);
    const service = new IncidentService(dbHelper.db as never, makeFakeAdvisoryLock());
    expect(await service.getManyEntityStates(["ghost"])).toEqual({});
    expect(dbHelper.getCallCount()).toBe(1);
  });

  it("yields an empty systemIds array for an incident with no systems", async () => {
    const dbHelper = createProgrammableSelectDb([
      [{ id: "inc-1", status: "monitoring", severity: "critical" }],
      [], // no junction rows
    ]);
    const service = new IncidentService(dbHelper.db as never, makeFakeAdvisoryLock());
    const out = await service.getManyEntityStates(["inc-1"]);
    expect(out["inc-1"]).toEqual({
      status: "monitoring",
      severity: "critical",
      systemIds: [],
    });
  });
});

describe("IncidentService.getIncident (batched detail read)", () => {
  const createdAt = new Date("2026-06-01T10:00:00.000Z");
  const updatedAt = new Date("2026-06-01T10:05:00.000Z");

  it("assembles the detail from incident + systems + updates + links (4 queries, one tx)", async () => {
    const dbHelper = createProgrammableSelectDb([
      // 1st: the incident row.
      [
        {
          id: "inc-1",
          title: "DB down",
          description: null,
          status: "investigating",
          severity: "critical",
          suppressNotifications: false,
          healthOverride: null,
          createdAt,
          updatedAt,
        },
      ],
      // 2nd: system associations.
      [{ systemId: "sys-a" }, { systemId: "sys-b" }],
      // 3rd: the full (unfiltered) timeline.
      [
        {
          id: "u1",
          incidentId: "inc-1",
          message: "looking",
          statusChange: "investigating",
          visibility: "public",
          createdAt,
          editedAt: null,
          createdBy: null,
        },
      ],
      // 4th: hotlinks.
      [
        {
          id: "lnk-1",
          incidentId: "inc-1",
          label: "Runbook",
          url: "https://a",
          visibility: "public",
          createdAt,
        },
      ],
    ]);
    const service = new IncidentService(
      dbHelper.db as never,
      makeFakeAdvisoryLock(),
    );

    const out = await service.getIncident("inc-1");

    expect(out?.systemIds).toEqual(["sys-a", "sys-b"]);
    // null description normalized to undefined, nullable update fields too.
    expect(out?.description).toBeUndefined();
    expect(out?.updates).toEqual([
      {
        id: "u1",
        incidentId: "inc-1",
        message: "looking",
        statusChange: "investigating",
        visibility: "public",
        createdAt,
        editedAt: undefined,
        editHistory: [],
        createdBy: undefined,
      },
    ]);
    expect(out?.links.map((l) => l.id)).toEqual(["lnk-1"]);
    // Exactly the 4 reads (no per-row fan-out), all issued on the tx.
    expect(dbHelper.getCallCount()).toBe(4);
  });

  it("returns undefined after a single query when the incident is absent", async () => {
    const dbHelper = createProgrammableSelectDb([[]]);
    const service = new IncidentService(
      dbHelper.db as never,
      makeFakeAdvisoryLock(),
    );
    expect(await service.getIncident("ghost")).toBeUndefined();
    // The systems/updates/links reads are skipped once the incident is missing.
    expect(dbHelper.getCallCount()).toBe(1);
  });
});

describe("IncidentService.listIncidents (set-based system grouping)", () => {
  const createdAt = new Date("2026-06-01T10:00:00.000Z");
  const updatedAt = new Date("2026-06-01T10:05:00.000Z");
  const incidentRow = (id: string, description: string | null) => ({
    id,
    title: id,
    description,
    status: "investigating" as const,
    severity: "major" as const,
    suppressNotifications: false,
    healthOverride: null,
    createdAt,
    updatedAt,
  });

  it("fetches all system associations in ONE junction query (no N+1) and groups them", async () => {
    const dbHelper = createProgrammableSelectDb([
      // 1st: the incidents matching the status filter.
      [incidentRow("inc-1", null), incidentRow("inc-2", "elevated latency")],
      // 2nd (and ONLY): a single inArray junction read for BOTH incidents.
      [
        { incidentId: "inc-1", systemId: "sys-a" },
        { incidentId: "inc-1", systemId: "sys-b" },
        { incidentId: "inc-2", systemId: "sys-c" },
      ],
    ]);
    const service = new IncidentService(
      dbHelper.db as never,
      makeFakeAdvisoryLock(),
    );

    const out = await service.listIncidents({ includeResolved: true });

    expect(out.map((i) => i.id)).toEqual(["inc-1", "inc-2"]);
    expect(out[0].systemIds).toEqual(["sys-a", "sys-b"]);
    expect(out[1].systemIds).toEqual(["sys-c"]);
    expect(out[0].description).toBeUndefined();
    expect(out[1].description).toBe("elevated latency");
    // 1 incidents read + exactly 1 junction read, regardless of row count.
    expect(dbHelper.getCallCount()).toBe(2);
  });

  it("skips the junction query when no incidents match", async () => {
    const dbHelper = createProgrammableSelectDb([[]]);
    const service = new IncidentService(
      dbHelper.db as never,
      makeFakeAdvisoryLock(),
    );
    expect(await service.listIncidents()).toEqual([]);
    expect(dbHelper.getCallCount()).toBe(1);
  });

  it("resolves the system's incident ids first when filtering by systemId (3 queries total)", async () => {
    const dbHelper = createProgrammableSelectDb([
      // 1st: incident ids attached to the system.
      [{ incidentId: "inc-1" }],
      // 2nd: the incidents themselves (status-filtered).
      [incidentRow("inc-1", null)],
      // 3rd: the single junction grouping read.
      [{ incidentId: "inc-1", systemId: "sys-a" }],
    ]);
    const service = new IncidentService(
      dbHelper.db as never,
      makeFakeAdvisoryLock(),
    );

    const out = await service.listIncidents({ systemId: "sys-a" });

    expect(out.map((i) => i.id)).toEqual(["inc-1"]);
    expect(out[0].systemIds).toEqual(["sys-a"]);
    expect(dbHelper.getCallCount()).toBe(3);
  });
});

describe("IncidentService.getIncidentsForSystem (set-based system grouping)", () => {
  const createdAt = new Date("2026-06-01T10:00:00.000Z");
  const updatedAt = new Date("2026-06-01T10:05:00.000Z");

  it("groups memberships from ONE junction query after resolving the system's incidents", async () => {
    const dbHelper = createProgrammableSelectDb([
      // 1st: incident ids attached to the system.
      [{ incidentId: "inc-1" }, { incidentId: "inc-2" }],
      // 2nd: non-resolved incidents for those ids.
      [
        {
          id: "inc-1",
          title: "A",
          description: null,
          status: "investigating",
          severity: "major",
          suppressNotifications: false,
          healthOverride: null,
          createdAt,
          updatedAt,
        },
        {
          id: "inc-2",
          title: "B",
          description: null,
          status: "monitoring",
          severity: "minor",
          suppressNotifications: false,
          healthOverride: null,
          createdAt,
          updatedAt,
        },
      ],
      // 3rd (and ONLY) junction read for BOTH incidents' full membership.
      [
        { incidentId: "inc-1", systemId: "sys-a" },
        { incidentId: "inc-1", systemId: "sys-b" },
        { incidentId: "inc-2", systemId: "sys-a" },
      ],
    ]);
    const service = new IncidentService(
      dbHelper.db as never,
      makeFakeAdvisoryLock(),
    );

    const out = await service.getIncidentsForSystem("sys-a");

    expect(out.map((i) => i.id)).toEqual(["inc-1", "inc-2"]);
    // Each incident carries its FULL membership, not just the queried system.
    expect(out[0].systemIds).toEqual(["sys-a", "sys-b"]);
    expect(out[1].systemIds).toEqual(["sys-a"]);
    expect(dbHelper.getCallCount()).toBe(3);
  });

  it("returns [] without a junction query when the system has no incidents", async () => {
    const dbHelper = createProgrammableSelectDb([[]]);
    const service = new IncidentService(
      dbHelper.db as never,
      makeFakeAdvisoryLock(),
    );
    expect(await service.getIncidentsForSystem("sys-x")).toEqual([]);
    expect(dbHelper.getCallCount()).toBe(1);
  });
});

describe("IncidentService.listOpenIncidentsBySystem (global signals read)", () => {
  it("returns {} without a junction query when no open incidents exist", async () => {
    const dbHelper = createProgrammableSelectDb([
      // 1st query: open incidents -> none, so the junction query is skipped.
      [],
    ]);
    const service = new IncidentService(
      dbHelper.db as never,
      makeFakeAdvisoryLock(),
    );
    expect(await service.listOpenIncidentsBySystem()).toEqual({});
    expect(dbHelper.getCallCount()).toBe(1);
  });

  it("groups open incidents under each affected system, full systemIds per entry", async () => {
    const createdAt = new Date("2026-06-01T10:00:00.000Z");
    const updatedAt = new Date("2026-06-01T10:05:00.000Z");
    const dbHelper = createProgrammableSelectDb([
      // 1st query: open incident rows (resolved excluded by the WHERE clause).
      [
        {
          id: "inc-1",
          title: "DB down",
          description: null,
          status: "investigating",
          severity: "critical",
          suppressNotifications: false,
          createdAt,
          updatedAt,
        },
        {
          id: "inc-2",
          title: "Slow",
          description: "elevated latency",
          status: "monitoring",
          severity: "major",
          suppressNotifications: false,
          createdAt,
          updatedAt,
        },
      ],
      // 2nd query: junction rows. inc-1 spans two systems; inc-2 one.
      [
        { incidentId: "inc-1", systemId: "sys-a" },
        { incidentId: "inc-1", systemId: "sys-b" },
        { incidentId: "inc-2", systemId: "sys-a" },
      ],
    ]);
    const service = new IncidentService(
      dbHelper.db as never,
      makeFakeAdvisoryLock(),
    );

    const out = await service.listOpenIncidentsBySystem();

    expect(Object.keys(out).sort()).toEqual(["sys-a", "sys-b"]);
    // sys-a sees both incidents; sys-b only inc-1.
    expect(out["sys-a"].map((i) => i.id)).toEqual(["inc-1", "inc-2"]);
    expect(out["sys-b"].map((i) => i.id)).toEqual(["inc-1"]);
    // Multi-system incident carries its FULL systemIds under each key.
    expect(out["sys-a"][0].systemIds).toEqual(["sys-a", "sys-b"]);
    expect(out["sys-b"][0].systemIds).toEqual(["sys-a", "sys-b"]);
    // null description is normalized to undefined (IncidentWithSystems shape).
    expect(out["sys-a"][0].description).toBeUndefined();
    expect(out["sys-a"][1].description).toBe("elevated latency");
    expect(dbHelper.getCallCount()).toBe(2);
  });

  it("yields no entry for an open incident with no system associations", async () => {
    const dbHelper = createProgrammableSelectDb([
      [
        {
          id: "inc-orphan",
          title: "Orphan",
          description: null,
          status: "identified",
          severity: "minor",
          suppressNotifications: false,
          createdAt: new Date("2026-06-01T10:00:00.000Z"),
          updatedAt: new Date("2026-06-01T10:00:00.000Z"),
        },
      ],
      [], // no junction rows
    ]);
    const service = new IncidentService(
      dbHelper.db as never,
      makeFakeAdvisoryLock(),
    );
    expect(await service.listOpenIncidentsBySystem()).toEqual({});
    expect(dbHelper.getCallCount()).toBe(2);
  });
});

/**
 * Table-backed fake `db` for the dedup-create path. Models just enough of
 * the Drizzle surface the service touches (select/insert by TABLE IDENTITY,
 * `.from`/`.where`/`.limit`, and a serializing `transaction`).
 *
 * Crucially `transaction(fn)` models `pg_advisory_xact_lock`: it serializes
 * callers on the lock key seen in the `tx.execute(...)` SQL, so concurrent
 * dedup-creates run their find-then-create one-at-a-time — exactly the
 * guarantee M3 needs. Because the test confines data to a single system,
 * the (ignored) WHERE clauses don't change which rows match.
 */
function createDedupFakeDb() {
  const store = {
    incidents: [] as Array<Record<string, unknown>>,
    incidentSystems: [] as Array<Record<string, unknown>>,
    incidentUpdates: [] as Array<Record<string, unknown>>,
    incidentLinks: [] as Array<Record<string, unknown>>,
  };

  const tableKey = (
    table: unknown,
  ): keyof typeof store | undefined => {
    if (table === incidents) return "incidents";
    if (table === incidentSystems) return "incidentSystems";
    if (table === incidentUpdates) return "incidentUpdates";
    if (table === incidentLinks) return "incidentLinks";
    return undefined;
  };

  // Per-key serialization (the xact-lock model).
  const tails = new Map<string, Promise<unknown>>();

  function buildSelect() {
    return (projection?: Record<string, unknown>) => {
      const project = (
        list: Array<Record<string, unknown>>,
      ): Array<Record<string, unknown>> => {
        if (!projection) return list;
        const keys = Object.keys(projection);
        return list.map((r) => {
          const out: Record<string, unknown> = {};
          for (const k of keys) out[k] = r[k];
          return out;
        });
      };
      const from = (table: unknown) => {
        const key = tableKey(table);
        const rows = key ? project([...store[key]]) : [];
        const limit = (n: number) => Promise.resolve(rows.slice(0, n));
        const where = () =>
          Object.assign(Promise.resolve(rows), { limit });
        return Object.assign(Promise.resolve(rows), { where, limit });
      };
      return { from };
    };
  }

  function buildInsert() {
    return (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const key = tableKey(table);
        if (key) store[key].push({ ...vals });
        return Promise.resolve();
      },
    });
  }

  const db = {
    select: buildSelect(),
    insert: buildInsert(),
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      // The lock key is embedded in the SQL the helper runs via tx.execute.
      let lockKey = "default";
      const tx = {
        // A transaction handle exposes the same query surface as `db`, so a
        // service method that wraps its writes in `db.transaction` can issue
        // select/insert against the same backing store (e.g. createIncident,
        // which now commits the incident + its system links atomically).
        select: buildSelect(),
        insert: buildInsert(),
        execute: async (sqlObj: unknown) => {
          // Drizzle sql`` carries the interpolated key in its params; the
          // helper interpolates exactly one param (the lock key).
          const params = (sqlObj as { queryChunks?: unknown[] }).queryChunks;
          const found = JSON.stringify(params ?? sqlObj).match(
            /incident\.dedupe-open-for-system:[^"\\]+/,
          );
          if (found) lockKey = found[0];
          return { rows: [] };
        },
      };
      // Serialize on the lock key: chain after the current tail.
      const prior = tails.get(lockKey) ?? Promise.resolve();
      let resolveTail!: () => void;
      const myTail = new Promise<void>((r) => (resolveTail = r));
      tails.set(
        lockKey,
        prior.then(() => myTail),
      );
      await prior;
      try {
        return await fn(tx);
      } finally {
        resolveTail();
      }
    },
  };

  return { db: db as unknown, store };
}

describe("IncidentService.createIncidentDedupedForSystem (M3)", () => {
  it("two concurrent dedupe creates for one system open exactly ONE incident", async () => {
    const { db, store } = createDedupFakeDb();
    const service = new IncidentService(db as never, makeFakeAdvisoryLock());

    const input = {
      title: "Down",
      severity: "critical" as const,
      systemIds: ["sys-1"],
      suppressNotifications: false,
    };

    // Sustained + flapping fire concurrently for the same system. Without
    // the per-system lock both would find no open incident and both create.
    const [a, b] = await Promise.all([
      service.createIncidentDedupedForSystem(input, "sys-1"),
      service.createIncidentDedupedForSystem(input, "sys-1"),
    ]);

    // Exactly one incident row created.
    expect(store.incidents).toHaveLength(1);
    // One created, one reused — both return the same incident id.
    expect(a.incident.id).toBe(b.incident.id);
    expect([a.reused, b.reused].filter(Boolean)).toHaveLength(1);
  });
});

/**
 * Mock DB for the join query in `getActiveHealthOverrides`
 * (`select().from().innerJoin().where()` resolving to a flat joined-row list).
 * The status/override filtering is enforced by the real query builder, so the
 * test supplies rows as the DB would AFTER filtering and asserts the mapping +
 * per-system grouping into the RPC shape.
 */
function createJoinDb(rows: unknown[]) {
  const select = mock(() => {
    const whereResult = Promise.resolve(rows);
    const innerJoin = mock(() => ({ where: mock(() => whereResult) }));
    const from = mock(() => ({ innerJoin }));
    return { from };
  });
  return { db: { select } as unknown };
}

describe("IncidentService.getActiveHealthOverrides", () => {
  it("returns an empty record without querying when given no systems", async () => {
    const { db } = createJoinDb([]);
    const service = new IncidentService(db as never, makeFakeAdvisoryLock());
    expect(await service.getActiveHealthOverrides([])).toEqual({});
  });

  it("groups active overrides by system and shapes each into { status, incidentId, incidentTitle }", async () => {
    const { db } = createJoinDb([
      {
        systemId: "sys-1",
        incidentId: "inc-1",
        incidentTitle: "License server revoked",
        healthOverride: "unhealthy",
      },
      {
        systemId: "sys-1",
        incidentId: "inc-2",
        incidentTitle: "Slow logins",
        healthOverride: "degraded",
      },
      {
        systemId: "sys-2",
        incidentId: "inc-3",
        incidentTitle: "Vendor maintenance",
        healthOverride: "degraded",
      },
    ]);
    const service = new IncidentService(db as never, makeFakeAdvisoryLock());

    const result = await service.getActiveHealthOverrides(["sys-1", "sys-2"]);

    expect(result).toEqual({
      "sys-1": [
        {
          status: "unhealthy",
          incidentId: "inc-1",
          incidentTitle: "License server revoked",
        },
        {
          status: "degraded",
          incidentId: "inc-2",
          incidentTitle: "Slow logins",
        },
      ],
      "sys-2": [
        {
          status: "degraded",
          incidentId: "inc-3",
          incidentTitle: "Vendor maintenance",
        },
      ],
    });
  });

  it("omits systems with no active override", async () => {
    const { db } = createJoinDb([
      {
        systemId: "sys-1",
        incidentId: "inc-1",
        incidentTitle: "Down",
        healthOverride: "unhealthy",
      },
    ]);
    const service = new IncidentService(db as never, makeFakeAdvisoryLock());

    const result = await service.getActiveHealthOverrides(["sys-1", "sys-2"]);

    expect(Object.keys(result)).toEqual(["sys-1"]);
  });
});
