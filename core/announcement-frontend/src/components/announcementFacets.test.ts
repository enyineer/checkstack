import { describe, expect, test } from "bun:test";
import {
  AnnouncementSeverityEnum,
  AnnouncementVisibilityEnum,
} from "@checkstack/announcement-common";
import {
  announcementFacetIds,
  DISPLAY_MODE_LABELS,
  SEVERITY_FILTER_OPTIONS,
  SEVERITY_LABELS,
  STATUS_FILTER_OPTIONS,
  VISIBILITY_FILTER_OPTIONS,
  VISIBILITY_LABELS,
} from "./announcementFacets";
import { STATUS_BUCKETS } from "./announcementStatus.logic";

/**
 * The MATCHING is declared on the table's columns (`filterValue`) and is
 * exercised by `columnDerivedFacets` in `@checkstack/ui`. What this module still
 * owns - and what these tests guard - is the option lists: the labels a person
 * reads, and an order that carries meaning where the raw values would not.
 */

describe("announcement filter options", () => {
  test("severity is ordered by IMPACT, not alphabetically", () => {
    // Deriving from the data would sort these critical / info / warning, which
    // reads as noise against a scale that runs info -> warning -> critical.
    expect(SEVERITY_FILTER_OPTIONS.map((o) => o.value)).toEqual([
      "info",
      "warning",
      "critical",
    ]);
  });

  test("status options match the stat strip's buckets, in the same order", () => {
    // The dropdown and the cards above the table must agree.
    expect(STATUS_FILTER_OPTIONS.map((o) => o.value)).toEqual(
      STATUS_BUCKETS.map((b) => b.status),
    );
    expect(STATUS_FILTER_OPTIONS.map((o) => o.label)).toEqual(
      STATUS_BUCKETS.map((b) => b.label),
    );
  });

  test("every schema value is offered, so no announcement is unreachable", () => {
    expect(SEVERITY_FILTER_OPTIONS.map((o) => o.value)).toEqual(
      expect.arrayContaining([...AnnouncementSeverityEnum.options]),
    );
    expect(VISIBILITY_FILTER_OPTIONS.map((o) => o.value)).toEqual(
      expect.arrayContaining([...AnnouncementVisibilityEnum.options]),
    );
  });

  test("visibility reads as a phrase, never as the bare enum value", () => {
    // `all` derived would label itself "all", which beside the unconstrained
    // "Any visibility" option reads as a second way of saying "no filter".
    expect(VISIBILITY_FILTER_OPTIONS).toEqual([
      { value: "all", label: "Everyone" },
      { value: "authenticated", label: "Authenticated only" },
    ]);
  });

  test("the facet ids are the filterable column ids", () => {
    expect(announcementFacetIds).toEqual(["severity", "status", "visibility"]);
  });

  test("every label map is total (no undefined label can reach a pill)", () => {
    for (const severity of AnnouncementSeverityEnum.options) {
      expect(SEVERITY_LABELS[severity]).toBeString();
    }
    for (const visibility of AnnouncementVisibilityEnum.options) {
      expect(VISIBILITY_LABELS[visibility]).toBeString();
    }
    for (const mode of ["banner", "both", "dashboard"] as const) {
      expect(DISPLAY_MODE_LABELS[mode]).toBeString();
    }
  });
});
