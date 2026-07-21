import { describe, expect, test } from "bun:test";
import {
  ANY_FILTER,
  ANNOUNCEMENT_SEVERITIES,
  ANNOUNCEMENT_VISIBILITIES,
  NO_ANNOUNCEMENT_FILTERS,
  filterAnnouncements,
  hasActiveAnnouncementFilters,
  parseSeverityFilter,
  parseStatusFilter,
  parseVisibilityFilter,
  type AnnouncementFilters,
  type FilterableAnnouncement,
} from "./announcementFilters.logic";

const NOW = new Date("2026-06-20T12:00:00Z");
const PAST = new Date("2026-06-19T12:00:00Z");
const FUTURE = new Date("2026-06-21T12:00:00Z");

function announcement(
  overrides: Partial<FilterableAnnouncement> = {},
): FilterableAnnouncement {
  return {
    title: "Planned database migration",
    severity: "info",
    visibility: "all",
    active: true,
    startsAt: null,
    expiresAt: null,
    ...overrides,
  };
}

const filters = (
  overrides: Partial<AnnouncementFilters> = {},
): AnnouncementFilters => ({ ...NO_ANNOUNCEMENT_FILTERS, ...overrides });

describe("hasActiveAnnouncementFilters", () => {
  test("the default state constrains nothing", () => {
    expect(hasActiveAnnouncementFilters(NO_ANNOUNCEMENT_FILTERS)).toBe(false);
  });

  test("whitespace alone is not a filter", () => {
    expect(hasActiveAnnouncementFilters(filters({ query: "   " }))).toBe(false);
  });

  test("any single facet counts as active", () => {
    expect(hasActiveAnnouncementFilters(filters({ query: "db" }))).toBe(true);
    expect(hasActiveAnnouncementFilters(filters({ severity: "critical" }))).toBe(
      true,
    );
    expect(hasActiveAnnouncementFilters(filters({ status: "expired" }))).toBe(
      true,
    );
    expect(hasActiveAnnouncementFilters(filters({ visibility: "all" }))).toBe(
      true,
    );
  });

  test('visibility "all" is a real constraint, not the unconstrained sentinel', () => {
    // `all` means "visible to everyone" - a genuine filter. The unconstrained
    // sentinel is `any`, precisely so these two cannot be confused.
    expect(hasActiveAnnouncementFilters(filters({ visibility: "all" }))).toBe(
      true,
    );
    expect(
      hasActiveAnnouncementFilters(filters({ visibility: ANY_FILTER })),
    ).toBe(false);
  });
});

describe("filter value parsing", () => {
  test("accepts every value its own schema defines", () => {
    for (const severity of ANNOUNCEMENT_SEVERITIES) {
      expect(parseSeverityFilter(severity)).toBe(severity);
    }
    for (const visibility of ANNOUNCEMENT_VISIBILITIES) {
      expect(parseVisibilityFilter(visibility)).toBe(visibility);
    }
    for (const status of [
      "active",
      "scheduled",
      "expired",
      "inactive",
    ] as const) {
      expect(parseStatusFilter(status)).toBe(status);
    }
  });

  test("accepts the unconstrained sentinel", () => {
    expect(parseSeverityFilter(ANY_FILTER)).toBe(ANY_FILTER);
    expect(parseStatusFilter(ANY_FILTER)).toBe(ANY_FILTER);
    expect(parseVisibilityFilter(ANY_FILTER)).toBe(ANY_FILTER);
  });

  test("an unrecognised value degrades to unconstrained, never to a dead filter", () => {
    // Falling back to the value itself would produce a constraint nothing can
    // match, i.e. a permanently empty table with no obvious cause.
    expect(parseSeverityFilter("catastrophic")).toBe(ANY_FILTER);
    expect(parseStatusFilter("")).toBe(ANY_FILTER);
    expect(parseVisibilityFilter("everyone")).toBe(ANY_FILTER);
  });

  test("does not confuse the facets with each other", () => {
    // `all` is a visibility, not a severity or a status.
    expect(parseSeverityFilter("all")).toBe(ANY_FILTER);
    expect(parseStatusFilter("all")).toBe(ANY_FILTER);
    expect(parseVisibilityFilter("all")).toBe("all");
    // `active` is a status, not a visibility.
    expect(parseVisibilityFilter("active")).toBe(ANY_FILTER);
  });
});

describe("filterAnnouncements", () => {
  test("returns everything, in order, when nothing is constrained", () => {
    const rows = [
      announcement({ title: "First" }),
      announcement({ title: "Second" }),
      announcement({ title: "Third" }),
    ];
    expect(
      filterAnnouncements({
        announcements: rows,
        filters: NO_ANNOUNCEMENT_FILTERS,
        now: NOW,
      }).map((a) => a.title),
    ).toEqual(["First", "Second", "Third"]);
  });

  test("search matches the title case-insensitively on a substring", () => {
    const rows = [
      announcement({ title: "Planned database migration" }),
      announcement({ title: "Office move" }),
    ];
    expect(
      filterAnnouncements({
        announcements: rows,
        filters: filters({ query: "DATABASE" }),
        now: NOW,
      }),
    ).toHaveLength(1);
  });

  test("a whitespace-only search does not hide anything", () => {
    const rows = [announcement(), announcement()];
    expect(
      filterAnnouncements({
        announcements: rows,
        filters: filters({ query: "  " }),
        now: NOW,
      }),
    ).toHaveLength(2);
  });

  test("filters by severity", () => {
    const rows = [
      announcement({ severity: "info" }),
      announcement({ severity: "warning" }),
      announcement({ severity: "critical" }),
    ];
    expect(
      filterAnnouncements({
        announcements: rows,
        filters: filters({ severity: "critical" }),
        now: NOW,
      }).map((a) => a.severity),
    ).toEqual(["critical"]);
  });

  test("filters by visibility", () => {
    const rows = [
      announcement({ visibility: "all" }),
      announcement({ visibility: "authenticated" }),
    ];
    expect(
      filterAnnouncements({
        announcements: rows,
        filters: filters({ visibility: "authenticated" }),
        now: NOW,
      }).map((a) => a.visibility),
    ).toEqual(["authenticated"]);
  });

  test("filters by DERIVED lifecycle status, not a stored field", () => {
    const rows = [
      announcement({ title: "live" }),
      announcement({ title: "waiting", startsAt: FUTURE }),
      announcement({ title: "done", expiresAt: PAST }),
      announcement({ title: "off", active: false }),
    ];

    const byStatus = (status: AnnouncementFilters["status"]) =>
      filterAnnouncements({
        announcements: rows,
        filters: filters({ status }),
        now: NOW,
      }).map((a) => a.title);

    expect(byStatus("active")).toEqual(["live"]);
    expect(byStatus("scheduled")).toEqual(["waiting"]);
    expect(byStatus("expired")).toEqual(["done"]);
    expect(byStatus("inactive")).toEqual(["off"]);
  });

  test("status is evaluated against the injected `now`", () => {
    // The same row is "scheduled" before its start date and "active" after it,
    // so the filter must never be judged against wall-clock time in a test.
    const rows = [announcement({ title: "window", startsAt: FUTURE })];
    expect(
      filterAnnouncements({
        announcements: rows,
        filters: filters({ status: "scheduled" }),
        now: NOW,
      }),
    ).toHaveLength(1);
    expect(
      filterAnnouncements({
        announcements: rows,
        filters: filters({ status: "active" }),
        now: new Date("2026-06-22T12:00:00Z"),
      }),
    ).toHaveLength(1);
  });

  test("facets are ANDed, not ORed", () => {
    const rows = [
      announcement({ title: "keep", severity: "critical", active: false }),
      announcement({ title: "wrong severity", severity: "info", active: false }),
      announcement({ title: "wrong status", severity: "critical" }),
    ];
    expect(
      filterAnnouncements({
        announcements: rows,
        filters: filters({ severity: "critical", status: "inactive" }),
        now: NOW,
      }).map((a) => a.title),
    ).toEqual(["keep"]);
  });

  test("preserves the operator-defined order of the rows it keeps", () => {
    // The table's rows arrive in the persisted browse order; filtering must
    // never reshuffle them, or the reorder controls would disagree with the view.
    const rows = [
      announcement({ title: "3rd", severity: "critical" }),
      announcement({ title: "1st", severity: "info" }),
      announcement({ title: "2nd", severity: "critical" }),
    ];
    expect(
      filterAnnouncements({
        announcements: rows,
        filters: filters({ severity: "critical" }),
        now: NOW,
      }).map((a) => a.title),
    ).toEqual(["3rd", "2nd"]);
  });
});
