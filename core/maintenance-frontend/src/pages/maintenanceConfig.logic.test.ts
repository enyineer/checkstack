import { describe, expect, test } from "bun:test";
import {
  canComplete,
  summarizeSystemNames,
  selectableMaintenanceIds,
  completableMaintenanceIds,
  pruneSelection,
  summarizeBulkOutcome,
  type NamedSystem,
  type SelectableMaintenance,
} from "./maintenanceConfig.logic";

const SYSTEMS: NamedSystem[] = [
  { id: "a", name: "Auth" },
  { id: "b", name: "Billing" },
  { id: "c", name: "Catalog" },
  { id: "d", name: "Dashboard" },
];

describe("summarizeSystemNames", () => {
  test("resolves ids to names", () => {
    expect(
      summarizeSystemNames({ systemIds: ["a", "b"], systems: SYSTEMS }),
    ).toBe("Auth, Billing");
  });

  test("falls back to the raw id for unknown systems", () => {
    expect(
      summarizeSystemNames({ systemIds: ["a", "zzz"], systems: SYSTEMS }),
    ).toBe("Auth, zzz");
  });

  test("shows at most three names plus a +N more token", () => {
    expect(
      summarizeSystemNames({
        systemIds: ["a", "b", "c", "d"],
        systems: SYSTEMS,
      }),
    ).toBe("Auth, Billing, Catalog, +1 more");
  });

  test("exactly three names get no overflow token", () => {
    expect(
      summarizeSystemNames({
        systemIds: ["a", "b", "c"],
        systems: SYSTEMS,
      }),
    ).toBe("Auth, Billing, Catalog");
  });

  test("empty list is an empty string", () => {
    expect(summarizeSystemNames({ systemIds: [], systems: SYSTEMS })).toBe("");
  });
});

describe("canComplete", () => {
  test("scheduled and in-progress windows are completable", () => {
    expect(canComplete({ status: "scheduled" })).toBe(true);
    expect(canComplete({ status: "in_progress" })).toBe(true);
  });

  test("completed and cancelled windows are not", () => {
    expect(canComplete({ status: "completed" })).toBe(false);
    expect(canComplete({ status: "cancelled" })).toBe(false);
  });
});

const MAINTENANCES: SelectableMaintenance[] = [
  { id: "a", status: "scheduled" },
  { id: "b", status: "completed" },
  { id: "c", status: "in_progress" },
];

// Only "a" and "c" are manageable by this caller (team-scoped gate).
const canAccess = (id: string) => id === "a" || id === "c";

describe("selectableMaintenanceIds", () => {
  test("returns only ids the caller can manage", () => {
    expect(
      selectableMaintenanceIds({ maintenances: MAINTENANCES, canAccess }),
    ).toEqual(["a", "c"]);
  });

  test("excludes rows the caller cannot manage even when present", () => {
    expect(
      selectableMaintenanceIds({
        maintenances: MAINTENANCES,
        canAccess: () => false,
      }),
    ).toEqual([]);
  });
});

describe("completableMaintenanceIds", () => {
  test("only selected, manageable, completable ids", () => {
    const selectedIds = new Set(["a", "b", "c"]);
    expect(
      completableMaintenanceIds({
        selectedIds,
        maintenances: MAINTENANCES,
        canAccess,
      }),
    ).toEqual(["a", "c"]);
  });

  test("drops an already-completed manageable row", () => {
    const maintenances: SelectableMaintenance[] = [
      { id: "a", status: "completed" },
      { id: "c", status: "in_progress" },
    ];
    const selectedIds = new Set(["a", "c"]);
    expect(
      completableMaintenanceIds({ selectedIds, maintenances, canAccess }),
    ).toEqual(["c"]);
  });
});

describe("pruneSelection", () => {
  test("drops ids no longer selectable (deleted row / revoked grant)", () => {
    const selectedIds = new Set(["a", "c", "gone"]);
    expect(pruneSelection({ selectedIds, selectableIds: ["a", "c"] })).toEqual([
      "a",
      "c",
    ]);
  });
});

describe("summarizeBulkOutcome", () => {
  test("all succeeded -> just the success count", () => {
    expect(
      summarizeBulkOutcome({
        results: [{ status: "deleted" }, { status: "deleted" }],
        successStatus: "deleted",
        successLabel: "deleted",
      }),
    ).toBe("2 deleted");
  });

  test("partial success -> success + skipped counts", () => {
    expect(
      summarizeBulkOutcome({
        results: [
          { status: "completed" },
          { status: "forbidden" },
          { status: "notFound" },
        ],
        successStatus: "completed",
        successLabel: "completed",
      }),
    ).toBe("1 completed, 2 skipped");
  });
});
