import { describe, test, expect } from "bun:test";
import type { AuthUser } from "@checkstack/backend-api";
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

/**
 * Tiny stub of the slice the contributor reads, recording whether the global
 * query ran so we can assert the access gate short-circuits before any read.
 */
function stubService(bySystem: Record<string, MaintenanceWithSystems[]>): {
  service: Pick<MaintenanceService, "getActiveMaintenancesBySystem">;
  calls: { read: number };
} {
  const calls = { read: 0 };
  return {
    calls,
    service: {
      getActiveMaintenancesBySystem: async () => {
        calls.read += 1;
        return bySystem;
      },
    },
  };
}

describe("createMaintenanceSignalsContributor", () => {
  test("uses the shared source id", () => {
    const { service } = stubService({});
    const contributor = createMaintenanceSignalsContributor({ service });
    expect(contributor.sourceId).toBe(MAINTENANCE_SIGNAL_SOURCE);
  });

  test("returns {} and skips the read when the principal lacks maintenance.read", async () => {
    const { service, calls } = stubService({
      sysA: [activeWindow()],
    });
    const contributor = createMaintenanceSignalsContributor({ service });

    const principal: AuthUser = {
      type: "user",
      id: "u1",
      accessRules: ["incident.incident.read"],
    };

    const result = await contributor.read({ principal });

    expect(result).toEqual({});
    expect(calls.read).toBe(0);
  });

  test("returns derived signals for an allowed principal", async () => {
    const { service, calls } = stubService({
      sysA: [activeWindow({ id: "m1", title: "Database upgrade" })],
    });
    const contributor = createMaintenanceSignalsContributor({ service });

    const principal: AuthUser = {
      type: "user",
      id: "u1",
      accessRules: ["maintenance.maintenance.read"],
    };

    const result = await contributor.read({ principal });

    expect(calls.read).toBe(1);
    expect(Object.keys(result)).toEqual(["sysA"]);
    expect(result.sysA[0]).toMatchObject({
      source: MAINTENANCE_SIGNAL_SOURCE,
      tone: "info",
      label: "Under maintenance",
      detail: "Database upgrade",
      since: "2026-06-07T10:00:00.000Z",
    });
  });

  test("a maintenance.manage grant satisfies the read gate", async () => {
    const { service } = stubService({
      sysA: [activeWindow()],
    });
    const contributor = createMaintenanceSignalsContributor({ service });

    const principal: AuthUser = {
      type: "user",
      id: "u1",
      accessRules: ["maintenance.maintenance.manage"],
    };

    const result = await contributor.read({ principal });
    expect(Object.keys(result)).toEqual(["sysA"]);
  });

  test("treats a service principal as trusted (sees signals)", async () => {
    // Service principals are trusted backend-to-backend callers (the RPC
    // middleware skips access checks for them), so the contributor returns
    // signals rather than gating them out.
    const { service, calls } = stubService({
      sysA: [activeWindow()],
    });
    const contributor = createMaintenanceSignalsContributor({ service });

    const principal: AuthUser = { type: "service", pluginId: "scheduler" };

    const result = await contributor.read({ principal });

    expect(Object.keys(result)).toEqual(["sysA"]);
    expect(calls.read).toBe(1);
  });
});
