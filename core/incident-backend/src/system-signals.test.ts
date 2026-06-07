import { describe, test, expect, mock } from "bun:test";
import type { AuthUser } from "@checkstack/backend-api";
import type { IncidentWithSystems } from "@checkstack/incident-common";
import { createIncidentSignalsContributor } from "./system-signals";
import type { IncidentService } from "./service";

const openIncident: IncidentWithSystems = {
  id: "inc-1",
  title: "Database down",
  description: undefined,
  status: "investigating",
  severity: "critical",
  suppressNotifications: false,
  createdAt: new Date("2026-06-01T10:00:00.000Z"),
  updatedAt: new Date("2026-06-01T10:00:00.000Z"),
  systemIds: ["sys-1"],
};

function makeService(
  bySystem: Record<string, IncidentWithSystems[]>,
): Pick<IncidentService, "listOpenIncidentsBySystem"> {
  return {
    listOpenIncidentsBySystem: mock(async () => bySystem),
  };
}

const userWithRead: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["incident.incident.read"],
};

const userWithoutRead: AuthUser = {
  type: "user",
  id: "u2",
  accessRules: [],
};

const serviceUser: AuthUser = { type: "service", pluginId: "other" };

describe("incident system-signals contributor", () => {
  test("sourceId is the shared incident source id", () => {
    const contributor = createIncidentSignalsContributor({
      service: makeService({}),
    });
    expect(contributor.sourceId).toBe("incident");
  });

  test("returns {} when the principal lacks incident.read and does not query", async () => {
    const service = makeService({ "sys-1": [openIncident] });
    const contributor = createIncidentSignalsContributor({ service });

    const result = await contributor.read({ principal: userWithoutRead });

    expect(result).toEqual({});
    expect(service.listOpenIncidentsBySystem).not.toHaveBeenCalled();
  });

  test("treats a service principal as trusted (sees signals)", async () => {
    // Service principals are trusted backend-to-backend callers - the RPC
    // middleware skips access checks for them - so the contributor returns
    // signals rather than gating them out.
    const service = makeService({ "sys-1": [openIncident] });
    const contributor = createIncidentSignalsContributor({ service });

    const result = await contributor.read({ principal: serviceUser });

    expect(Object.keys(result)).toEqual(["sys-1"]);
    expect(service.listOpenIncidentsBySystem).toHaveBeenCalled();
  });

  test("returns derived signals for every system with an open incident when allowed", async () => {
    const service = makeService({ "sys-1": [openIncident] });
    const contributor = createIncidentSignalsContributor({ service });

    const result = await contributor.read({ principal: userWithRead });

    expect(service.listOpenIncidentsBySystem).toHaveBeenCalledTimes(1);
    expect(Object.keys(result)).toEqual(["sys-1"]);
    expect(result["sys-1"]).toHaveLength(1);
    expect(result["sys-1"][0]).toMatchObject({
      source: "incident",
      tone: "error",
      label: "Critical incident",
      detail: "Database down",
      since: "2026-06-01T10:00:00.000Z",
    });
  });

  test("manage grant satisfies the read gate", async () => {
    const service = makeService({ "sys-1": [openIncident] });
    const contributor = createIncidentSignalsContributor({ service });

    const result = await contributor.read({
      principal: {
        type: "user",
        id: "u3",
        accessRules: ["incident.incident.manage"],
      },
    });

    expect(result["sys-1"]).toHaveLength(1);
  });
});
