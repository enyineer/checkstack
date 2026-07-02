import { describe, expect, test } from "bun:test";
import {
  canResolveIncident,
  selectableIncidentIds,
  resolvableIncidentIds,
  pruneSelection,
  summarizeBulkOutcome,
  type SelectableIncident,
} from "./incidentConfig.logic";

const INCIDENTS: SelectableIncident[] = [
  { id: "a", status: "investigating" },
  { id: "b", status: "resolved" },
  { id: "c", status: "monitoring" },
];

// Only "a" and "c" are manageable by this caller (team-scoped gate).
const canAccess = (id: string) => id === "a" || id === "c";

describe("canResolveIncident", () => {
  test("non-resolved incidents are resolvable", () => {
    expect(canResolveIncident({ status: "investigating" })).toBe(true);
    expect(canResolveIncident({ status: "monitoring" })).toBe(true);
  });

  test("resolved incidents are not resolvable", () => {
    expect(canResolveIncident({ status: "resolved" })).toBe(false);
  });
});

describe("selectableIncidentIds", () => {
  test("returns only ids the caller can manage", () => {
    expect(selectableIncidentIds({ incidents: INCIDENTS, canAccess })).toEqual([
      "a",
      "c",
    ]);
  });

  test("excludes rows the caller cannot manage even when present", () => {
    expect(
      selectableIncidentIds({ incidents: INCIDENTS, canAccess: () => false }),
    ).toEqual([]);
  });
});

describe("resolvableIncidentIds", () => {
  test("only selected, manageable, non-resolved ids", () => {
    // Select all three; "b" is resolved (ineligible), "b" also not manageable.
    const selectedIds = new Set(["a", "b", "c"]);
    expect(
      resolvableIncidentIds({ selectedIds, incidents: INCIDENTS, canAccess }),
    ).toEqual(["a", "c"]);
  });

  test("drops an already-resolved manageable row", () => {
    const incidents: SelectableIncident[] = [
      { id: "a", status: "resolved" },
      { id: "c", status: "monitoring" },
    ];
    const selectedIds = new Set(["a", "c"]);
    expect(resolvableIncidentIds({ selectedIds, incidents, canAccess })).toEqual(
      ["c"],
    );
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
        results: [
          { status: "deleted" },
          { status: "deleted" },
          { status: "deleted" },
        ],
        successStatus: "deleted",
        successLabel: "deleted",
      }),
    ).toBe("3 deleted");
  });

  test("partial success -> success + skipped counts", () => {
    expect(
      summarizeBulkOutcome({
        results: [
          { status: "resolved" },
          { status: "forbidden" },
          { status: "notFound" },
        ],
        successStatus: "resolved",
        successLabel: "resolved",
      }),
    ).toBe("1 resolved, 2 skipped");
  });
});
