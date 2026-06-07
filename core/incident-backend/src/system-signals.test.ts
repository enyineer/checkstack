import { describe, test, expect, mock } from "bun:test";
import type { AuthUser } from "@checkstack/backend-api";
import type { SystemAccessResolver } from "@checkstack/ai-backend";
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

// The per-source gate (global rule, team grants, service trust) is owned and
// tested by `createGatedSystemSignalsContributor`; here we use simple resolver
// stubs and focus on this plugin's wiring (source id, service, shared deriver).
const allowAll: SystemAccessResolver = {
  accessibleSystemIds: async ({ systemIds }) => systemIds,
};
const denyAll: SystemAccessResolver = { accessibleSystemIds: async () => [] };

const userWithRead: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["incident.incident.read"],
};
const userWithoutRead: AuthUser = { type: "user", id: "u2", accessRules: [] };

describe("incident system-signals contributor", () => {
  test("uses the shared incident source id", () => {
    const contributor = createIncidentSignalsContributor({
      service: makeService({}),
      resolver: allowAll,
    });
    expect(contributor.sourceId).toBe("incident");
  });

  test("wires the service + shared deriver for an authorized principal", async () => {
    const service = makeService({ "sys-1": [openIncident] });
    const contributor = createIncidentSignalsContributor({
      service,
      resolver: allowAll,
    });

    const result = await contributor.read({ principal: userWithRead });

    expect(result.accessible).toBe(true);
    expect(Object.keys(result.signals)).toEqual(["sys-1"]);
    expect(result.signals["sys-1"][0]).toMatchObject({
      source: "incident",
      tone: "error",
      label: "Critical incident",
      detail: "Database down",
      since: "2026-06-01T10:00:00.000Z",
    });
  });

  test("filters to team-granted systems for a non-global user", async () => {
    const service = makeService({
      "sys-1": [openIncident],
      "sys-2": [{ ...openIncident, id: "inc-2", systemIds: ["sys-2"] }],
    });
    const recorded: string[] = [];
    const resolver: SystemAccessResolver = {
      accessibleSystemIds: async ({ resourceType, systemIds }) => {
        recorded.push(resourceType);
        return systemIds.filter((id) => id === "sys-2");
      },
    };
    const contributor = createIncidentSignalsContributor({ service, resolver });

    const result = await contributor.read({ principal: userWithoutRead });

    expect(Object.keys(result.signals)).toEqual(["sys-2"]);
    expect(recorded).toEqual(["incident.incident"]);
  });

  test("a non-global user with no team grants gets nothing", async () => {
    const contributor = createIncidentSignalsContributor({
      service: makeService({ "sys-1": [openIncident] }),
      resolver: denyAll,
    });
    const result = await contributor.read({ principal: userWithoutRead });
    expect(result).toEqual({ accessible: false, signals: {} });
  });
});
