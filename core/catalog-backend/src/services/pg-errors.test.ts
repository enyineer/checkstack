import { describe, it, expect } from "bun:test";
import { isUniqueViolation } from "./pg-errors";

describe("isUniqueViolation", () => {
  it("detects a direct unique violation (code 23505)", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("detects a wrapped unique violation (on cause)", () => {
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
  });

  it("ignores other Postgres errors (e.g. FK violation 23503)", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation({ cause: { code: "23503" } })).toBe(false);
  });

  it("ignores non-pg-shaped errors", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation({})).toBe(false);
  });
});
