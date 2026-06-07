import { describe, test, expect } from "bun:test";
import type { AuthUser } from "@checkstack/backend-api";
import type { SystemAccessResolver } from "@checkstack/ai-backend";
import type { MaintenanceWithSystems } from "@checkstack/maintenance-common";
import { MAINTENANCE_SIGNAL_SOURCE } from "@checkstack/maintenance-common";
import { createMaintenanceSignalsContributor } from "./system-signals";
import type { MaintenanceService } from "./service";

const activeWindow = (
  over: Partial<MaintenanceWithSystems> = {},
): MaintenanceWithSystems => ({
  id: "m1",
  title: "Database upgrade",
  description: undefined,
  suppressNotifications: false,
  status: "in_progress",
  startAt: new Date("2026-06-07T10:00:00Z"),
  endAt: new Date("2026-06-07T12:00:00Z"),
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
  systemIds: ["sysA"],
  ...over,
});

function stubService(
  bySystem: Record<string, MaintenanceWithSystems[]>,
): Pick<MaintenanceService, "getActiveMaintenancesBySystem"> {
  return { getActiveMaintenancesBySystem: async () => bySystem };
}

// The per-source gate is owned/tested by createGatedSystemSignalsContributor.
const allowAll: SystemAccessResolver = {
  accessibleSystemIds: async ({ systemIds }) => systemIds,
};
const denyAll: SystemAccessResolver = { accessibleSystemIds: async () => [] };
const userWith = (accessRules: string[]): AuthUser => ({
  type: "user",
  id: "u1",
  accessRules,
});

describe("createMaintenanceSignalsContributor", () => {
  test("uses the shared source id", () => {
    const contributor = createMaintenanceSignalsContributor({
      service: stubService({}),
      resolver: allowAll,
    });
    expect(contributor.sourceId).toBe(MAINTENANCE_SIGNAL_SOURCE);
  });

  test("wires the service + shared deriver for an allowed principal", async () => {
    const contributor = createMaintenanceSignalsContributor({
      service: stubService({ sysA: [activeWindow()] }),
      resolver: allowAll,
    });

    const result = await contributor.read({
      principal: userWith(["maintenance.maintenance.read"]),
    });

    expect(Object.keys(result.signals)).toEqual(["sysA"]);
    expect(result.signals.sysA[0]).toMatchObject({
      source: MAINTENANCE_SIGNAL_SOURCE,
      tone: "info",
      label: "Under maintenance",
      detail: "Database upgrade",
      since: "2026-06-07T10:00:00.000Z",
    });
  });

  test("routes a non-global user through the team gate (no grants -> nothing)", async () => {
    const contributor = createMaintenanceSignalsContributor({
      service: stubService({ sysA: [activeWindow()] }),
      resolver: denyAll,
    });

    const result = await contributor.read({ principal: userWith([]) });

    expect(result).toEqual({ accessible: false, signals: {} });
  });
});
