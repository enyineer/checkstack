import { describe, expect, test } from "bun:test";
import { access } from "@checkstack/common";
import { collectAnonymousUsableRuleIds } from "./plugin-manager";

// A fake contract is just a record of procedures; each procedure carries its
// metadata under `~orpc.meta`, exactly like a real oRPC contract procedure.
const proc = (userType: string, access_: ReturnType<typeof access>[]) => ({
  ["~orpc"]: { meta: { userType, access: access_ } },
});

const incidentRead = access("incident", "read", "", { pluginId: "incident" });
const incidentManage = access("incident", "manage", "", {
  pluginId: "incident",
});
const catalogRead = access("system", "read", "", { pluginId: "catalog" });

describe("collectAnonymousUsableRuleIds", () => {
  test("includes rules required by a public procedure (qualified id)", () => {
    const contracts = [
      { getIncidents: proc("public", [incidentRead]) },
      { getSystems: proc("public", [catalogRead]) },
    ];
    expect(collectAnonymousUsableRuleIds(contracts).sort()).toEqual([
      "catalog.system.read",
      "incident.incident.read",
    ]);
  });

  test("excludes rules required only by authenticated/user procedures", () => {
    const contracts = [
      {
        createIncident: proc("authenticated", [incidentManage]),
        deleteIncident: proc("user", [incidentManage]),
      },
    ];
    expect(collectAnonymousUsableRuleIds(contracts)).toEqual([]);
  });

  test("a rule on BOTH a public and an authenticated procedure is usable", () => {
    const contracts = [
      {
        getIncidents: proc("public", [incidentRead]),
        createIncident: proc("authenticated", [incidentManage]),
      },
    ];
    // read is usable (public); manage is not (only authenticated).
    expect(collectAnonymousUsableRuleIds(contracts)).toEqual([
      "incident.incident.read",
    ]);
  });

  test("ignores procedures without metadata and anonymous-userType ones", () => {
    const contracts = [
      { notAProc: {} as unknown },
      // anonymous userType skips access checks entirely, so its rules are not
      // 'usable via grant' - they would never be consulted.
      { ping: proc("anonymous", [incidentRead]) },
    ];
    expect(collectAnonymousUsableRuleIds(contracts)).toEqual([]);
  });
});
