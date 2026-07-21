import { describe, expect, test } from "bun:test";
import { applyTableFilters, EMPTY_TABLE_FILTERS } from "@checkstack/ui";
import type { Announcement } from "@checkstack/announcement-common";
import {
  announcementFacetIds,
  announcementFacets,
  DISPLAY_MODE_LABELS,
  SEVERITY_LABELS,
  VISIBILITY_LABELS,
} from "./announcementFacets";

const PAST = new Date("2020-01-01T00:00:00Z");
const FUTURE = new Date("2999-01-01T00:00:00Z");

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  // Only the fields the facets read matter; the rest satisfy the type.
  return {
    id: "a1",
    title: "Planned database migration",
    message: "",
    severity: "info",
    visibility: "all",
    displayMode: "banner",
    active: true,
    startsAt: null,
    expiresAt: null,
    createdAt: PAST,
    updatedAt: PAST,
    sortOrder: 0,
    ...overrides,
  } as Announcement;
}

const filterBy = (rows: Announcement[], facets: Record<string, string>) =>
  applyTableFilters({
    rows,
    state: { ...EMPTY_TABLE_FILTERS, facets },
    facets: announcementFacets,
    searchAccessors: [(row: Announcement) => row.title],
  });

describe("announcementFacets", () => {
  test("exposes exactly the three declared facets", () => {
    expect(announcementFacetIds).toEqual(["severity", "status", "visibility"]);
  });

  test("every severity and visibility the schema allows is offered", () => {
    const severity = announcementFacets.find((f) => f.id === "severity");
    expect(severity?.options.map((o) => o.value)).toEqual([
      "info",
      "warning",
      "critical",
    ]);
    const visibility = announcementFacets.find((f) => f.id === "visibility");
    expect(visibility?.options.map((o) => o.value)).toEqual([
      "all",
      "authenticated",
    ]);
  });

  test("the status facet offers every lifecycle bucket", () => {
    const status = announcementFacets.find((f) => f.id === "status");
    expect(status?.options.map((o) => o.value)).toEqual([
      "active",
      "scheduled",
      "expired",
      "inactive",
    ]);
  });

  test("filters by severity", () => {
    const rows = [
      announcement({ id: "a", severity: "critical" }),
      announcement({ id: "b", severity: "info" }),
    ];
    expect(filterBy(rows, { severity: "critical" }).map((r) => r.id)).toEqual([
      "a",
    ]);
  });

  test("filters by visibility", () => {
    const rows = [
      announcement({ id: "a", visibility: "all" }),
      announcement({ id: "b", visibility: "authenticated" }),
    ];
    expect(
      filterBy(rows, { visibility: "authenticated" }).map((r) => r.id),
    ).toEqual(["b"]);
  });

  test("status matches the DERIVED lifecycle, not a stored field", () => {
    // An announcement carries no `status` column - it is computed from `active`
    // and the start/expiry window, so the facet must stay correct as that
    // window opens and closes.
    const rows = [
      announcement({ id: "live" }),
      announcement({ id: "waiting", startsAt: FUTURE }),
      announcement({ id: "done", expiresAt: PAST }),
      announcement({ id: "off", active: false }),
    ];
    expect(filterBy(rows, { status: "active" }).map((r) => r.id)).toEqual([
      "live",
    ]);
    expect(filterBy(rows, { status: "scheduled" }).map((r) => r.id)).toEqual([
      "waiting",
    ]);
    expect(filterBy(rows, { status: "expired" }).map((r) => r.id)).toEqual([
      "done",
    ]);
    expect(filterBy(rows, { status: "inactive" }).map((r) => r.id)).toEqual([
      "off",
    ]);
  });

  test("facets are ANDed", () => {
    const rows = [
      announcement({ id: "keep", severity: "critical", active: false }),
      announcement({ id: "drop", severity: "info", active: false }),
    ];
    expect(
      filterBy(rows, { severity: "critical", status: "inactive" }).map(
        (r) => r.id,
      ),
    ).toEqual(["keep"]);
  });

  test("every label map is total (no undefined label can reach a pill)", () => {
    for (const severity of ["info", "warning", "critical"] as const) {
      expect(SEVERITY_LABELS[severity]).toBeString();
    }
    for (const visibility of ["all", "authenticated"] as const) {
      expect(VISIBILITY_LABELS[visibility]).toBeString();
    }
    for (const mode of ["banner", "both", "dashboard"] as const) {
      expect(DISPLAY_MODE_LABELS[mode]).toBeString();
    }
  });
});
