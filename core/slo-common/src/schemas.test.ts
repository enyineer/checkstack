import { describe, expect, test } from "bun:test";
import {
  CreateSloObjectiveInputSchema,
  SLO_MAX_WINDOW_DAYS,
  SloWindowDaysSchema,
} from "./schemas";

/**
 * `windowDays` is the load-bearing bound: the engine derives window boundaries
 * with `Date(now - windowDays * 86_400_000)`, so an unbounded value overflows
 * past the max representable Date and produces `Invalid Date`. That row commits
 * but then poisons EVERY read of the system's objectives (the serializer throws
 * `RangeError: Invalid time value`) - a stored cluster-wide DoS the fuzzing pass
 * found. The schema bound is what prevents the poison row from ever existing.
 */
describe("SloWindowDaysSchema", () => {
  test("accepts a normal window", () => {
    expect(SloWindowDaysSchema.parse(30)).toBe(30);
    expect(SloWindowDaysSchema.parse(SLO_MAX_WINDOW_DAYS)).toBe(
      SLO_MAX_WINDOW_DAYS,
    );
  });

  test("rejects zero and negative windows", () => {
    expect(SloWindowDaysSchema.safeParse(0).success).toBe(false);
    expect(SloWindowDaysSchema.safeParse(-1).success).toBe(false);
  });

  test("rejects non-integer windows", () => {
    expect(SloWindowDaysSchema.safeParse(1.5).success).toBe(false);
  });

  test("rejects the date-poisoning value above the max", () => {
    expect(SloWindowDaysSchema.safeParse(SLO_MAX_WINDOW_DAYS + 1).success).toBe(
      false,
    );
    // The exact value the fuzzer used to poison the SLO read path.
    expect(SloWindowDaysSchema.safeParse(100_000_000).success).toBe(false);
  });

  test("a max-window objective produces a valid Date in the engine arithmetic", () => {
    const windowStart = new Date(
      Date.now() - SLO_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    expect(Number.isNaN(windowStart.getTime())).toBe(false);
  });

  test("CreateSloObjectiveInputSchema rejects an out-of-range window", () => {
    const result = CreateSloObjectiveInputSchema.safeParse({
      systemId: "sys-1",
      target: 99.9,
      windowDays: 100_000_000,
    });
    expect(result.success).toBe(false);
  });
});
