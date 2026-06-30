import { describe, expect, it } from "bun:test";
import type { MaintenanceWithSystems } from "@checkstack/maintenance-common";
import { selectUpcomingMaintenances } from "./dashboardUpcoming.logic";

const NOW = new Date("2026-06-30T12:00:00.000Z");

/** Minimal factory: only the fields the selector reads are meaningful. */
function mk(
  overrides: Partial<MaintenanceWithSystems> & { id: string },
): MaintenanceWithSystems {
  return {
    id: overrides.id,
    title: overrides.title ?? "Maintenance",
    description: overrides.description,
    suppressNotifications: overrides.suppressNotifications ?? false,
    status: overrides.status ?? "scheduled",
    startAt: overrides.startAt ?? new Date("2026-07-01T10:00:00.000Z"),
    endAt: overrides.endAt ?? new Date("2026-07-01T11:00:00.000Z"),
    createdAt: overrides.createdAt ?? new Date("2026-06-29T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-06-29T00:00:00.000Z"),
    systemIds: overrides.systemIds ?? [],
  };
}

describe("selectUpcomingMaintenances", () => {
  it("keeps only scheduled windows (not yet started)", () => {
    const result = selectUpcomingMaintenances({
      now: NOW,
      maintenances: [
        mk({ id: "scheduled" }),
        mk({
          id: "in-progress",
          status: "in_progress",
          startAt: new Date("2026-06-30T11:00:00.000Z"),
          endAt: new Date("2026-06-30T13:00:00.000Z"),
        }),
      ],
    });
    // In-progress is handled by the signals filler, not here - must be dropped
    // to avoid duplicating it across two dashboard surfaces.
    expect(result.map((m) => m.id)).toEqual(["scheduled"]);
  });

  it("drops completed, cancelled, and in_progress windows", () => {
    const result = selectUpcomingMaintenances({
      now: NOW,
      maintenances: [
        mk({ id: "completed", status: "completed" }),
        mk({ id: "cancelled", status: "cancelled" }),
        mk({ id: "active", status: "in_progress" }),
      ],
    });
    expect(result).toEqual([]);
  });

  it("sorts by start time ascending, soonest first", () => {
    const result = selectUpcomingMaintenances({
      now: NOW,
      maintenances: [
        mk({
          id: "later",
          startAt: new Date("2026-07-05T10:00:00.000Z"),
        }),
        mk({
          id: "sooner",
          startAt: new Date("2026-07-02T10:00:00.000Z"),
        }),
        mk({
          id: "soonest",
          startAt: new Date("2026-07-01T10:00:00.000Z"),
        }),
      ],
    });
    expect(result.map((m) => m.id)).toEqual(["soonest", "sooner", "later"]);
  });

  it("caps the result to the configured limit", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      mk({
        id: `m${i}`,
        startAt: new Date(`2026-07-${10 + i}T10:00:00.000Z`),
      }),
    );
    const result = selectUpcomingMaintenances({
      now: NOW,
      maintenances: many,
    });
    expect(result).toHaveLength(5);
    expect(result.map((m) => m.id)).toEqual([
      "m0",
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
  });

  it("respects a custom limit", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      mk({
        id: `m${i}`,
        startAt: new Date(`2026-07-${10 + i}T10:00:00.000Z`),
      }),
    );
    const result = selectUpcomingMaintenances({
      now: NOW,
      maintenances: many,
      limit: 2,
    });
    expect(result.map((m) => m.id)).toEqual(["m0", "m1"]);
  });

  it("returns an empty array when nothing is upcoming", () => {
    expect(selectUpcomingMaintenances({ now: NOW, maintenances: [] })).toEqual(
      [],
    );
  });
});
