import { describe, expect, test } from "bun:test";
import { incidentContract } from "./rpc-contract";

/**
 * Team-scoping regression guards (G9 mis-keying).
 *
 * Grants for this plugin are keyed by INCIDENT id: the frontend
 * `TeamAccessEditor` writes `resourceType="incident.incident"`,
 * `resourceId={incident.id}`. The shared `incident` access rule, however,
 * declares `idParam: "systemId"`. Without a per-proc override, the
 * `autoAuthMiddleware` would look for `input.systemId` on object-scoped procs
 * like `updateIncident({ id })`, find nothing, and SKIP the instance check —
 * so any holder of `incident.manage` could edit any incident.
 *
 * These tests assert each proc carries the expected `instanceAccess` override
 * resolving to the INCIDENT's own id (or the correct list/record key), and that
 * the deliberately-unscoped procs carry NO override.
 *
 * `~orpc.meta` is the contract-procedure internals (the same accessor the
 * catalog contract test uses); `meta.instanceAccess` is the per-proc override
 * the middleware reads.
 */
interface InstanceAccessCreate {
  teamIdParam?: string;
  idField?: string;
}

interface InstanceAccessParentScope {
  resourceType?: string;
  action?: "read" | "manage";
  idParam?: string;
  recordKey?: string;
}

interface InstanceAccess {
  global?: boolean;
  idParam?: string;
  listKey?: string;
  recordKey?: string;
  create?: InstanceAccessCreate;
  parentScope?: InstanceAccessParentScope;
  bulkManage?: { idsParam?: string };
}

function instanceAccessFor(
  procName: keyof typeof incidentContract,
): InstanceAccess | undefined {
  const proc = incidentContract[procName] as unknown as Record<string, unknown>;
  const orpc = proc["~orpc"] as {
    meta?: { instanceAccess?: InstanceAccess };
  };
  return orpc.meta?.instanceAccess;
}

describe("incident contract object-scoped procs gate on the incident's own id", () => {
  const idProcs: Array<{
    proc: keyof typeof incidentContract;
    idParam: string;
  }> = [
    { proc: "getIncident", idParam: "id" },
    { proc: "updateIncident", idParam: "id" },
    { proc: "resolveIncident", idParam: "id" },
    { proc: "deleteIncident", idParam: "id" },
    { proc: "addUpdate", idParam: "incidentId" },
    { proc: "addLink", idParam: "incidentId" },
  ];

  for (const { proc, idParam } of idProcs) {
    test(`${proc} carries instanceAccess idParam=${idParam} (not systemId)`, () => {
      const access = instanceAccessFor(proc);
      expect(access).toBeDefined();
      expect(access?.idParam).toBe(idParam);
      // G9 regression: must NOT inherit the rule's mis-keyed systemId.
      expect(access?.idParam).not.toBe("systemId");
      expect(access?.listKey).toBeUndefined();
      expect(access?.recordKey).toBeUndefined();
    });
  }
});

describe("incident contract listIncidents post-filters by incident id", () => {
  test("listIncidents carries instanceAccess listKey=incidents", () => {
    const access = instanceAccessFor("listIncidents");
    expect(access).toBeDefined();
    expect(access?.listKey).toBe("incidents");
    expect(access?.idParam).toBeUndefined();
    expect(access?.recordKey).toBeUndefined();
  });
});

describe("incident contract system-scoped / unresolvable procs", () => {
  // SYSTEM-scoped reads now gate on catalog.system via parentScope (cross-plugin,
  // single-hop): "you may see incidents for system S iff you may see S".
  test("getIncidentsForSystem parent-scopes on catalog.system (read, idParam)", () => {
    const ps = instanceAccessFor("getIncidentsForSystem")?.parentScope;
    expect(ps?.resourceType).toBe("catalog.system");
    expect(ps?.action).toBe("read");
    expect(ps?.idParam).toBe("systemId");
  });

  test("getBulkIncidentsForSystems parent-scopes on catalog.system (read, recordKey)", () => {
    const ps = instanceAccessFor("getBulkIncidentsForSystems")?.parentScope;
    expect(ps?.resourceType).toBe("catalog.system");
    expect(ps?.action).toBe("read");
    expect(ps?.recordKey).toBe("incidents");
  });

  // removeLink is object-scoped on the OWNING incident via `incidentId` (mirrors
  // addLink), so a team-scoped incident manager may remove links on their own
  // incident without the global rule. The handler additionally scopes the delete
  // by `incidentId`, so a link id cannot be paired with a foreign incident.
  test("removeLink is object-scoped on the owning incident via 'incidentId'", () => {
    expect(instanceAccessFor("removeLink")).toEqual({ idParam: "incidentId" });
  });
});

describe("incident contract createIncident carries create-mode team ownership", () => {
  /**
   * Regression guard for create-mode wiring. The autoAuthMiddleware reads
   * `instanceAccess.create` on a mutation proc to:
   *   1. (pre-handler)  resolve + authorise the owning team from `input[teamIdParam]`.
   *   2. (post-handler) write a team-scoped grant keyed by `response[idField]`
   *      via `setResourceOwner`.
   *
   * Grants for this plugin are keyed `incident.incident / {incident.id}`, which
   * matches the `TeamAccessEditor` usage in `IncidentEditor` (resourceType =
   * "incident.incident", resourceId = incident.id). Hence `idField: "id"` and
   * `teamIdParam: "teamId"` are the correct values.
   *
   * `createAutoIncident` is intentionally excluded: it is `userType: "service"`
   * (system-generated incidents have no interactive team owner) and must NOT
   * carry create-mode.
   */
  test("createIncident carries instanceAccess.create with teamIdParam=teamId and idField=id", () => {
    const access = instanceAccessFor("createIncident");
    expect(access).toBeDefined();
    expect(access?.create).toBeDefined();
    expect(access?.create?.teamIdParam).toBe("teamId");
    expect(access?.create?.idField).toBe("id");
    // Must not carry object-scope fields — create-mode is distinct from read/update gating.
    expect(access?.idParam).toBeUndefined();
    expect(access?.listKey).toBeUndefined();
    expect(access?.recordKey).toBeUndefined();
  });

  test("createAutoIncident does NOT carry instanceAccess.create (service userType)", () => {
    const access = instanceAccessFor("createAutoIncident");
    expect(access?.create).toBeUndefined();
  });
});

describe("incident contract bulk actions gate per-id via bulkManage", () => {
  // Both bulk mutations authorize EACH id against the caller's manage grant
  // through the platform `bulkManage` instance-access mode, keyed on the `ids`
  // input array (RLAC: never fail open on a bulk WRITE).
  const bulkProcs: Array<keyof typeof incidentContract> = [
    "bulkDeleteIncidents",
    "bulkResolveIncidents",
  ];

  for (const proc of bulkProcs) {
    test(`${proc} declares instanceAccess.bulkManage.idsParam = "ids"`, () => {
      const access = instanceAccessFor(proc);
      expect(access).toBeDefined();
      expect(access?.bulkManage?.idsParam).toBe("ids");
      // Exactly one mode: no object/list/record/create scoping alongside it.
      expect(access?.idParam).toBeUndefined();
      expect(access?.listKey).toBeUndefined();
      expect(access?.recordKey).toBeUndefined();
      expect(access?.create).toBeUndefined();
      expect(access?.global).toBeUndefined();
    });

    test(`${proc} is gated on the incident.manage access rule`, () => {
      const procDef = incidentContract[proc] as unknown as Record<
        string,
        unknown
      >;
      const orpc = procDef["~orpc"] as {
        meta?: { access?: Array<{ id: string; resource: string; level: string }> };
      };
      const rule = orpc.meta?.access?.[0];
      expect(rule?.resource).toBe("incident");
      expect(rule?.level).toBe("manage");
    });
  }
});
