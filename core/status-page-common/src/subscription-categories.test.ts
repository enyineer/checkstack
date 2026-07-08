import { describe, test, expect } from "bun:test";
import {
  sourcePluginIdToCategory,
  clampSubscriptionCategories,
  clampSubscriptionSystemIds,
  SUBSCRIPTION_CATEGORIES,
  DEFAULT_SUBSCRIPTION_CATEGORIES,
} from "./subscription-categories";

describe("sourcePluginIdToCategory", () => {
  test("maps the three known source plugins to their categories", () => {
    expect(sourcePluginIdToCategory("incident")).toBe("incident");
    expect(sourcePluginIdToCategory("maintenance")).toBe("maintenance");
    // The healthcheck plugin id maps to the user-facing "health" category.
    expect(sourcePluginIdToCategory("healthcheck")).toBe("health");
  });

  test("returns null for any unknown / uncategorized source", () => {
    expect(sourcePluginIdToCategory("anomaly")).toBeNull();
    expect(sourcePluginIdToCategory("")).toBeNull();
    expect(sourcePluginIdToCategory("statuspage")).toBeNull();
  });

  test("category constants are internally consistent", () => {
    expect(SUBSCRIPTION_CATEGORIES).toEqual(["incident", "maintenance", "health"]);
    // Defaults are a subset of the full set and exclude the noisy health category.
    for (const c of DEFAULT_SUBSCRIPTION_CATEGORIES) {
      expect(SUBSCRIPTION_CATEGORIES).toContain(c);
    }
    expect(DEFAULT_SUBSCRIPTION_CATEGORIES).not.toContain("health");
  });
});

describe("clampSubscriptionCategories", () => {
  test("keeps valid categories, dropping unknowns and duplicates", () => {
    expect(
      clampSubscriptionCategories(["incident", "bogus", "incident", "health"]),
    ).toEqual(["incident", "health"]);
  });

  test("falls back to defaults when nothing valid is supplied", () => {
    expect(clampSubscriptionCategories(undefined)).toEqual([
      ...DEFAULT_SUBSCRIPTION_CATEGORIES,
    ]);
    expect(clampSubscriptionCategories([])).toEqual([
      ...DEFAULT_SUBSCRIPTION_CATEGORIES,
    ]);
    expect(clampSubscriptionCategories(["nope", "nada"])).toEqual([
      ...DEFAULT_SUBSCRIPTION_CATEGORIES,
    ]);
  });
});

describe("clampSubscriptionSystemIds", () => {
  const surfaced = new Set(["a", "b", "c"]);

  test("keeps only surfaced ids (deduped)", () => {
    expect(
      clampSubscriptionSystemIds({ requested: ["a", "x", "a", "b"], surfaced }),
    ).toEqual(["a", "b"]);
  });

  test("returns null (all systems) when none requested", () => {
    expect(clampSubscriptionSystemIds({ requested: undefined, surfaced })).toBeNull();
    expect(clampSubscriptionSystemIds({ requested: [], surfaced })).toBeNull();
  });

  test("returns null when every requested id is not surfaced (no leak)", () => {
    expect(
      clampSubscriptionSystemIds({ requested: ["x", "y"], surfaced }),
    ).toBeNull();
  });
});
