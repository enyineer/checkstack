import { describe, test, expect } from "bun:test";
import type { MaintenanceWithSystems } from "./schemas";
import {
  deriveMaintenanceSignals,
  MAINTENANCE_SIGNAL_SOURCE,
} from "./system-signals";

const maintenance = (
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

describe("deriveMaintenanceSignals", () => {
  test("emits one info signal per in_progress window, keyed by systemId", () => {
    const result = deriveMaintenanceSignals({
      maintenancesBySystem: {
        sysA: [maintenance({ id: "m1", title: "Database upgrade" })],
      },
    });

    expect(Object.keys(result)).toEqual(["sysA"]);
    expect(result.sysA).toHaveLength(1);
    const signal = result.sysA[0];
    expect(signal).toEqual({
      source: MAINTENANCE_SIGNAL_SOURCE,
      tone: "info",
      label: "Under maintenance",
      detail: "Database upgrade",
      href: "/maintenance/m1",
      accessRule: expect.objectContaining({ id: "maintenance.read" }),
      since: "2026-06-07T10:00:00.000Z",
      iconName: "Wrench",
    });
  });

  test("only surfaces in_progress windows (scheduled/completed dropped)", () => {
    const result = deriveMaintenanceSignals({
      maintenancesBySystem: {
        sysA: [
          maintenance({ id: "m1", status: "scheduled" }),
          maintenance({ id: "m2", status: "completed" }),
        ],
      },
    });

    expect(result).toEqual({});
  });

  test("omits systems with no active window", () => {
    const result = deriveMaintenanceSignals({
      maintenancesBySystem: {
        sysA: [maintenance({ id: "m1", status: "in_progress" })],
        sysB: [maintenance({ id: "m2", status: "scheduled" })],
      },
    });

    expect(Object.keys(result)).toEqual(["sysA"]);
  });

  test("emits multiple signals when a system has several active windows", () => {
    const result = deriveMaintenanceSignals({
      maintenancesBySystem: {
        sysA: [
          maintenance({ id: "m1", title: "DB upgrade" }),
          maintenance({ id: "m2", title: "Cache flush" }),
        ],
      },
    });

    expect(result.sysA.map((s) => s.detail)).toEqual([
      "DB upgrade",
      "Cache flush",
    ]);
  });

  test("restricts to the provided systemIds when given", () => {
    const result = deriveMaintenanceSignals({
      maintenancesBySystem: {
        sysA: [maintenance({ id: "m1", status: "in_progress" })],
        sysB: [maintenance({ id: "m2", status: "in_progress" })],
      },
      systemIds: ["sysB"],
    });

    expect(Object.keys(result)).toEqual(["sysB"]);
  });

  test("considers every system in the map when systemIds is omitted", () => {
    const result = deriveMaintenanceSignals({
      maintenancesBySystem: {
        sysA: [maintenance({ id: "m1", status: "in_progress" })],
        sysB: [maintenance({ id: "m2", status: "in_progress" })],
      },
    });

    expect(Object.keys(result).sort()).toEqual(["sysA", "sysB"]);
  });
});
