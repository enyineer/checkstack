import { describe, expect, test } from "bun:test";
import {
  deriveMaintenanceFieldErrors,
  isMaintenanceFormValid,
} from "./maintenanceEditor.logic";

const START = new Date("2026-01-01T10:00:00Z");
const END = new Date("2026-01-01T12:00:00Z");

const VALID = {
  title: "DB upgrade",
  selectedSystemCount: 2,
  startAt: START,
  endAt: END,
};

describe("deriveMaintenanceFieldErrors", () => {
  test("returns an empty map for a fully valid form", () => {
    expect(deriveMaintenanceFieldErrors(VALID)).toEqual({});
  });

  test("flags a blank title on the title field", () => {
    expect(deriveMaintenanceFieldErrors({ ...VALID, title: "" })).toEqual({
      title: "Title is required",
    });
    expect(deriveMaintenanceFieldErrors({ ...VALID, title: "   " })).toEqual({
      title: "Title is required",
    });
  });

  test("flags an empty system selection on the systems field", () => {
    expect(
      deriveMaintenanceFieldErrors({ ...VALID, selectedSystemCount: 0 }),
    ).toEqual({ systems: "At least one system must be selected" });
  });

  test("flags a missing start date on the startAt field", () => {
    expect(
      deriveMaintenanceFieldErrors({ ...VALID, startAt: undefined }),
    ).toEqual({ startAt: "Start date is required" });
  });

  test("flags a missing end date on the endAt field", () => {
    expect(
      deriveMaintenanceFieldErrors({ ...VALID, endAt: undefined }),
    ).toEqual({ endAt: "End date is required" });
  });

  test("flags an end that is not strictly after start on the endAt field", () => {
    expect(deriveMaintenanceFieldErrors({ ...VALID, endAt: START })).toEqual({
      endAt: "End date must be after start date",
    });
    expect(
      deriveMaintenanceFieldErrors({
        ...VALID,
        startAt: END,
        endAt: START,
      }),
    ).toEqual({ endAt: "End date must be after start date" });
  });

  test("does not run the date-order check when the start date is missing", () => {
    expect(
      deriveMaintenanceFieldErrors({
        ...VALID,
        startAt: undefined,
        endAt: START,
      }),
    ).toEqual({ startAt: "Start date is required" });
  });

  test("reports every failing field at once", () => {
    expect(
      deriveMaintenanceFieldErrors({
        title: "",
        selectedSystemCount: 0,
        startAt: undefined,
        endAt: undefined,
      }),
    ).toEqual({
      title: "Title is required",
      systems: "At least one system must be selected",
      startAt: "Start date is required",
      endAt: "End date is required",
    });
  });
});

describe("isMaintenanceFormValid", () => {
  test("is true for an empty error map", () => {
    expect(isMaintenanceFormValid({})).toBe(true);
  });

  test("is false when any field carries an error", () => {
    expect(isMaintenanceFormValid({ title: "Title is required" })).toBe(false);
  });

  test("agrees with the derived map for a valid form", () => {
    expect(isMaintenanceFormValid(deriveMaintenanceFieldErrors(VALID))).toBe(
      true,
    );
  });
});
