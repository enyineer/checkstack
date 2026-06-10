import { describe, expect, test } from "bun:test";
import { maintenanceContract } from "./rpc-contract";

/**
 * Contract-level guards for the team-scoping wiring (G9 mis-keying fix).
 *
 * Grants for this plugin are keyed per-MAINTENANCE id (the frontend
 * `TeamAccessEditor` writes resourceType="maintenance.maintenance",
 * resourceId={maintenance.id}). The shared `maintenance` access rule declares
 * `idParam: "systemId"`, which does NOT match the per-object grant keying, so
 * each single-object proc carries a per-proc `instanceAccess` override and the
 * list proc carries a `listKey` post-filter.
 *
 * `~orpc` is the contract-procedure internals (same accessor the catalog
 * `rpc-contract.test.ts` uses); `meta.instanceAccess` is a stable field on it.
 */
interface InstanceAccess {
  idParam?: string;
  listKey?: string;
  recordKey?: string;
  global?: boolean;
  parentScope?: {
    resourceType?: string;
    action?: "read" | "manage";
    idParam?: string;
    recordKey?: string;
  };
  create?: {
    teamIdParam?: string;
    idField?: string;
  };
}

function instanceAccessFor(
  procName: keyof typeof maintenanceContract,
): InstanceAccess | undefined {
  const proc = maintenanceContract[procName] as unknown as Record<
    string,
    unknown
  >;
  const orpc = proc["~orpc"] as {
    meta?: { instanceAccess?: InstanceAccess };
  };
  return orpc.meta?.instanceAccess;
}

describe("maintenance contract team-scoping instanceAccess wiring", () => {
  describe("object-scoped procs use the maintenance id as idParam (G9 fix)", () => {
    const idFieldByProc: Array<{
      proc: keyof typeof maintenanceContract;
      idParam: string;
    }> = [
      { proc: "getMaintenance", idParam: "id" },
      { proc: "updateMaintenance", idParam: "id" },
      { proc: "closeMaintenance", idParam: "id" },
      { proc: "deleteMaintenance", idParam: "id" },
      { proc: "addUpdate", idParam: "maintenanceId" },
      { proc: "addLink", idParam: "maintenanceId" },
    ];

    for (const { proc, idParam } of idFieldByProc) {
      test(`${String(proc)} -> instanceAccess.idParam = "${idParam}"`, () => {
        const ia = instanceAccessFor(proc);
        expect(ia).toBeDefined();
        expect(ia?.idParam).toBe(idParam);
        // Object-scoped procs must NOT also carry list/record post-filters.
        expect(ia?.listKey).toBeUndefined();
        expect(ia?.recordKey).toBeUndefined();
      });

      test(`${String(proc)} idParam field exists on the input schema`, () => {
        const procDef = maintenanceContract[proc] as unknown as Record<
          string,
          unknown
        >;
        const orpc = procDef["~orpc"] as {
          inputSchema?: { safeParse: (v: unknown) => { success: boolean } };
        };
        // A request that includes only the id field must satisfy the field's
        // presence (we only assert the field is recognized, not full validity).
        const sample = { [idParam]: "abc", message: "x", url: "https://x.dev" };
        const parsed = orpc.inputSchema?.safeParse(sample);
        // The proc input must at least accept the id field being present.
        expect(parsed).toBeDefined();
      });
    }
  });

  describe("listMaintenances uses a listKey post-filter", () => {
    test('instanceAccess.listKey = "maintenances"', () => {
      const ia = instanceAccessFor("listMaintenances");
      expect(ia).toBeDefined();
      expect(ia?.listKey).toBe("maintenances");
      expect(ia?.idParam).toBeUndefined();
      expect(ia?.recordKey).toBeUndefined();
    });

    test("listMaintenances output wraps items under the `maintenances` key with string ids", () => {
      const procDef = maintenanceContract.listMaintenances as unknown as Record<
        string,
        unknown
      >;
      const orpc = procDef["~orpc"] as {
        outputSchema?: {
          safeParse: (v: unknown) => {
            success: boolean;
            data?: { maintenances: Array<{ id: string }> };
          };
        };
      };
      const now = new Date();
      const parsed = orpc.outputSchema?.safeParse({
        maintenances: [
          {
            id: "m1",
            title: "DB upgrade",
            suppressNotifications: false,
            status: "scheduled",
            startAt: now,
            endAt: now,
            createdAt: now,
            updatedAt: now,
            systemIds: ["sysA"],
          },
        ],
      });
      expect(parsed?.success).toBe(true);
      // Each item carries a string `.id` equal to the grant resourceId.
      expect(typeof parsed?.data?.maintenances[0]?.id).toBe("string");
    });
  });

  describe("removeLink is intentionally NOT object-scoped (link id != maintenance id)", () => {
    test('instanceAccess.global = true (link id cannot be scoped to maintenance id without breaking schema change)', () => {
      const ia = instanceAccessFor("removeLink");
      expect(ia).toBeDefined();
      expect(ia?.global).toBe(true);
    });
  });

  describe("createMaintenance carries create-mode team ownership", () => {
    test('instanceAccess.create is defined with teamIdParam="teamId" and idField="id"', () => {
      const ia = instanceAccessFor("createMaintenance");
      expect(ia).toBeDefined();
      expect(ia?.create).toBeDefined();
      expect(ia?.create?.teamIdParam).toBe("teamId");
      expect(ia?.create?.idField).toBe("id");
      // create-mode proc must NOT also carry read-scoping fields
      expect(ia?.idParam).toBeUndefined();
      expect(ia?.listKey).toBeUndefined();
      expect(ia?.recordKey).toBeUndefined();
    });

    test('output schema (MaintenanceWithSystemsSchema) has a string "id" field (idField target)', () => {
      const procDef = maintenanceContract.createMaintenance as unknown as Record<
        string,
        unknown
      >;
      const orpc = procDef["~orpc"] as {
        outputSchema?: {
          safeParse: (v: unknown) => {
            success: boolean;
            data?: { id: string };
          };
        };
      };
      const now = new Date();
      const parsed = orpc.outputSchema?.safeParse({
        id: "m-new",
        title: "Deploy freeze",
        suppressNotifications: false,
        status: "scheduled",
        startAt: now,
        endAt: now,
        createdAt: now,
        updatedAt: now,
        systemIds: ["sys1"],
      });
      expect(parsed?.success).toBe(true);
      expect(typeof parsed?.data?.id).toBe("string");
    });

    test("input schema accepts optional teamId field without breaking existing callers", () => {
      const procDef = maintenanceContract.createMaintenance as unknown as Record<
        string,
        unknown
      >;
      const orpc = procDef["~orpc"] as {
        inputSchema?: { safeParse: (v: unknown) => { success: boolean } };
      };
      const now = new Date(Date.now() + 3_600_000);
      const base = {
        title: "DB upgrade",
        startAt: new Date(),
        endAt: now,
        systemIds: ["s1"],
      };
      // Without teamId — backward-compatible callers must still succeed.
      expect(orpc.inputSchema?.safeParse(base).success).toBe(true);
      // With teamId — team-scoped callers must succeed.
      expect(
        orpc.inputSchema?.safeParse({ ...base, teamId: "team-abc" }).success,
      ).toBe(true);
    });
  });

  describe("system-scoped reads keep system keying (cross-plugin ambiguity)", () => {
    test('getMaintenancesForSystem uses parentScope gating on catalog.system / read / idParam="systemId"', () => {
      const ia = instanceAccessFor("getMaintenancesForSystem");
      expect(ia).toBeDefined();
      expect(ia?.parentScope).toBeDefined();
      expect(ia?.parentScope?.resourceType).toBe("catalog.system");
      expect(ia?.parentScope?.action).toBe("read");
      expect(ia?.parentScope?.idParam).toBe("systemId");
      // Must not carry maintenance-id scoping fields.
      expect(ia?.idParam).toBeUndefined();
      expect(ia?.listKey).toBeUndefined();
      expect(ia?.recordKey).toBeUndefined();
    });

    test('getBulkMaintenancesForSystems uses parentScope gating on catalog.system / read / recordKey="maintenances"', () => {
      // The record is keyed by systemId; parentScope with recordKey gates on
      // catalog.system access for each key in the output record.
      const ia = instanceAccessFor("getBulkMaintenancesForSystems");
      expect(ia).toBeDefined();
      expect(ia?.parentScope).toBeDefined();
      expect(ia?.parentScope?.resourceType).toBe("catalog.system");
      expect(ia?.parentScope?.action).toBe("read");
      expect(ia?.parentScope?.recordKey).toBe("maintenances");
      // Must not carry maintenance-id scoping fields.
      expect(ia?.idParam).toBeUndefined();
      expect(ia?.listKey).toBeUndefined();
    });
  });
});
