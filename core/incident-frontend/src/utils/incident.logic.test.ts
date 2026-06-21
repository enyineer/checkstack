import { describe, expect, test } from "bun:test";
import {
  compareIncidentHistory,
  deriveIncidentFieldErrors,
  sortIncidentHistory,
  validateIncidentForm,
  validateIncidentUpdate,
  type SortableIncident,
} from "./incident.logic";

function incident(
  props: Partial<SortableIncident> & { id: string },
): SortableIncident & { id: string } {
  return {
    status: "investigating",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...props,
  };
}

describe("compareIncidentHistory", () => {
  test("active incidents sort before resolved ones", () => {
    const active = incident({ id: "a", status: "investigating" });
    const resolved = incident({ id: "r", status: "resolved" });
    expect(compareIncidentHistory(active, resolved)).toBeLessThan(0);
    expect(compareIncidentHistory(resolved, active)).toBeGreaterThan(0);
  });

  test("within the same active-ness, newer createdAt sorts first", () => {
    const older = incident({
      id: "o",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = incident({
      id: "n",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    expect(compareIncidentHistory(newer, older)).toBeLessThan(0);
  });

  test("accepts string createdAt values", () => {
    const older = incident({ id: "o", createdAt: "2026-01-01T00:00:00Z" });
    const newer = incident({ id: "n", createdAt: "2026-03-01T00:00:00Z" });
    expect(compareIncidentHistory(newer, older)).toBeLessThan(0);
  });
});

describe("sortIncidentHistory", () => {
  test("orders active-first then newest-first without mutating input", () => {
    const input = [
      incident({
        id: "resolved-new",
        status: "resolved",
        createdAt: new Date("2026-05-01T00:00:00Z"),
      }),
      incident({
        id: "active-old",
        status: "investigating",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
      incident({
        id: "active-new",
        status: "monitoring",
        createdAt: new Date("2026-03-01T00:00:00Z"),
      }),
    ];
    const sorted = sortIncidentHistory(input);
    expect(sorted.map((i) => i.id)).toEqual([
      "active-new",
      "active-old",
      "resolved-new",
    ]);
    // original order preserved
    expect(input.map((i) => i.id)).toEqual([
      "resolved-new",
      "active-old",
      "active-new",
    ]);
  });

  test("empty list returns empty", () => {
    expect(sortIncidentHistory([])).toEqual([]);
  });
});

describe("validateIncidentForm", () => {
  test("accepts a title and at least one system", () => {
    expect(
      validateIncidentForm({ title: "Outage", selectedSystemCount: 1 }),
    ).toEqual({ ok: true });
  });

  test("rejects a blank title before checking systems", () => {
    expect(
      validateIncidentForm({ title: "  ", selectedSystemCount: 0 }),
    ).toEqual({ ok: false, error: "Title is required" });
  });

  test("requires at least one system", () => {
    expect(
      validateIncidentForm({ title: "Outage", selectedSystemCount: 0 }),
    ).toEqual({ ok: false, error: "At least one system must be selected" });
  });
});

describe("deriveIncidentFieldErrors", () => {
  test("returns an empty map when title and a system are present", () => {
    expect(
      deriveIncidentFieldErrors({ title: "Outage", selectedSystemCount: 1 }),
    ).toEqual({});
  });

  test("flags a blank title", () => {
    expect(
      deriveIncidentFieldErrors({ title: "   ", selectedSystemCount: 1 }),
    ).toEqual({ title: "Title is required" });
  });

  test("flags no selected systems", () => {
    expect(
      deriveIncidentFieldErrors({ title: "Outage", selectedSystemCount: 0 }),
    ).toEqual({ systems: "At least one system must be selected" });
  });

  test("flags both fields when both are invalid", () => {
    expect(
      deriveIncidentFieldErrors({ title: "", selectedSystemCount: 0 }),
    ).toEqual({
      title: "Title is required",
      systems: "At least one system must be selected",
    });
  });
});

describe("validateIncidentUpdate", () => {
  test("accepts a non-blank message", () => {
    expect(validateIncidentUpdate({ message: "Working on it" })).toEqual({
      ok: true,
    });
  });

  test("rejects an empty or whitespace message", () => {
    expect(validateIncidentUpdate({ message: "" })).toEqual({
      ok: false,
      error: "Update message is required",
    });
    expect(validateIncidentUpdate({ message: "   " })).toEqual({
      ok: false,
      error: "Update message is required",
    });
  });
});
