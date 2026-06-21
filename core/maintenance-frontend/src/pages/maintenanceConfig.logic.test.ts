import { describe, expect, test } from "bun:test";
import {
  canComplete,
  summarizeSystemNames,
  type NamedSystem,
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
