import { describe, it, expect } from "bun:test";
import { mergeServiceNames } from "./service-name-suggestions";

describe("mergeServiceNames", () => {
  it("dedupes across the two keys and orders stably", () => {
    expect(
      mergeServiceNames(["checkout", "payments"], ["payments", "auth"]),
    ).toEqual(["auth", "checkout", "payments"]);
  });

  it("trims and drops empty / whitespace values", () => {
    expect(mergeServiceNames(["  billing ", "", "   "], undefined)).toEqual([
      "billing",
    ]);
  });

  it("tolerates every list being empty or missing", () => {
    expect(mergeServiceNames(undefined, [], undefined)).toEqual([]);
  });

  it("orders numerically-aware and case-insensitive", () => {
    expect(mergeServiceNames(["svc-10", "svc-2", "SVC-1"])).toEqual([
      "SVC-1",
      "svc-2",
      "svc-10",
    ]);
  });
});
