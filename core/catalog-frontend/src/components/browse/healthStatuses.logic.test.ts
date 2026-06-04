import { describe, expect, test } from "bun:test";
import type { CatalogHealthStatuses } from "@checkstack/catalog-common";
import { healthStatusesEqual } from "./healthStatuses.logic";

describe("healthStatusesEqual", () => {
  test("first report (prev null) is always a change", () => {
    expect(healthStatusesEqual(null, {})).toBe(false);
    expect(healthStatusesEqual(null, { a: "healthy" })).toBe(false);
  });

  test("same values in same shape are equal (ignores object identity)", () => {
    const prev: CatalogHealthStatuses = { a: "healthy", b: "degraded" };
    const next: CatalogHealthStatuses = { a: "healthy", b: "degraded" };
    expect(prev).not.toBe(next);
    expect(healthStatusesEqual(prev, next)).toBe(true);
  });

  test("two empty maps are equal", () => {
    expect(healthStatusesEqual({}, {})).toBe(true);
  });

  test("a changed status value is not equal", () => {
    expect(
      healthStatusesEqual({ a: "healthy" }, { a: "unhealthy" }),
    ).toBe(false);
  });

  test("an added system is not equal", () => {
    expect(
      healthStatusesEqual({ a: "healthy" }, { a: "healthy", b: "healthy" }),
    ).toBe(false);
  });

  test("a removed system is not equal", () => {
    expect(
      healthStatusesEqual({ a: "healthy", b: "healthy" }, { a: "healthy" }),
    ).toBe(false);
  });
});
