import { describe, it, expect } from "bun:test";
import {
  matchSuggestions,
  normalizeServiceName,
  DEFAULT_SUGGESTION_CAP,
  type SuggestibleSystem,
} from "./stream-system-suggestions.logic";

const sys = (id: string, name: string): SuggestibleSystem => ({ id, name });

describe("normalizeServiceName", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normalizeServiceName("Checkout-API")).toBe("checkoutapi");
    expect(normalizeServiceName("checkout_api")).toBe("checkoutapi");
    expect(normalizeServiceName("Checkout API")).toBe("checkoutapi");
    expect(normalizeServiceName("...")).toBe("");
  });
});

describe("matchSuggestions", () => {
  const systems = [
    sys("s1", "Checkout API"),
    sys("s2", "Billing"),
    sys("s3", "Search"),
  ];

  it("matches exact names case-insensitively", () => {
    const result = matchSuggestions({
      serviceNames: ["billing"],
      systems,
      linkedIds: [],
    });
    expect(result.map((s) => s.id)).toEqual(["s2"]);
  });

  it("matches loosely across separators and casing", () => {
    const result = matchSuggestions({
      serviceNames: ["checkout-api"],
      systems,
      linkedIds: [],
    });
    expect(result.map((s) => s.id)).toEqual(["s1"]);
  });

  it("returns nothing when no service name matches a system", () => {
    const result = matchSuggestions({
      serviceNames: ["payments", "unknown-service"],
      systems,
      linkedIds: [],
    });
    expect(result).toEqual([]);
  });

  it("excludes already-linked systems", () => {
    const result = matchSuggestions({
      serviceNames: ["billing", "search"],
      systems,
      linkedIds: ["s2"],
    });
    expect(result.map((s) => s.id)).toEqual(["s3"]);
  });

  it("de-duplicates a system matched by multiple service names", () => {
    const result = matchSuggestions({
      serviceNames: ["Checkout API", "checkout-api", "checkout_api"],
      systems,
      linkedIds: [],
    });
    expect(result.map((s) => s.id)).toEqual(["s1"]);
  });

  it("ignores blank / whitespace-only service names", () => {
    const result = matchSuggestions({
      serviceNames: ["", "   "],
      systems,
      linkedIds: [],
    });
    expect(result).toEqual([]);
  });

  it("orders results stably by name (numeric-aware)", () => {
    const many = [
      sys("a", "service-10"),
      sys("b", "service-2"),
      sys("c", "service-1"),
    ];
    const result = matchSuggestions({
      serviceNames: ["service-1", "service-2", "service-10"],
      systems: many,
      linkedIds: [],
    });
    expect(result.map((s) => s.name)).toEqual([
      "service-1",
      "service-2",
      "service-10",
    ]);
  });

  it("caps the number of suggestions", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      sys(`s${i}`, `service-${i}`),
    );
    const names = many.map((s) => s.name);
    const capped = matchSuggestions({
      serviceNames: names,
      systems: many,
      linkedIds: [],
      cap: 3,
    });
    expect(capped).toHaveLength(3);

    const defaulted = matchSuggestions({
      serviceNames: names,
      systems: many,
      linkedIds: [],
    });
    expect(defaulted).toHaveLength(DEFAULT_SUGGESTION_CAP);
  });
});
