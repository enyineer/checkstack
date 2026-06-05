import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/server";
import { mapPgErrorToHttp } from "./pg-http-errors";

/**
 * Guards the regression where a client-caused Postgres fault (bad uuid,
 * out-of-range int, over-long string, FK/unique violation) surfaced as a 500
 * instead of a 4xx. The fuzzing pass found that `where id = $1` with a non-uuid
 * `$1` reaches the driver and throws `22P02`, which oRPC reported as 500.
 */
describe("mapPgErrorToHttp", () => {
  test("maps invalid_text_representation (bad uuid/int) to 400", () => {
    const mapped = mapPgErrorToHttp({ code: "22P02" });
    expect(mapped).toBeInstanceOf(ORPCError);
    expect(mapped?.code).toBe("BAD_REQUEST");
  });

  test("maps numeric_value_out_of_range to 400", () => {
    expect(mapPgErrorToHttp({ code: "22003" })?.code).toBe("BAD_REQUEST");
  });

  test("maps string_data_right_truncation to 400", () => {
    expect(mapPgErrorToHttp({ code: "22001" })?.code).toBe("BAD_REQUEST");
  });

  test("maps foreign_key_violation to 400", () => {
    expect(mapPgErrorToHttp({ code: "23503" })?.code).toBe("BAD_REQUEST");
  });

  test("maps unique_violation to 409 CONFLICT", () => {
    expect(mapPgErrorToHttp({ code: "23505" })?.code).toBe("CONFLICT");
  });

  test("unwraps a Drizzle-wrapped driver error via cause", () => {
    const mapped = mapPgErrorToHttp({
      message: "wrapped",
      cause: { code: "22P02" },
    });
    expect(mapped?.code).toBe("BAD_REQUEST");
  });

  test("returns undefined for an unknown SQLSTATE (genuine 500 stays a 500)", () => {
    // 40001 = serialization_failure: a real server fault, not client input.
    expect(mapPgErrorToHttp({ code: "40001" })).toBeUndefined();
  });

  test("returns undefined for a non-Postgres error", () => {
    expect(mapPgErrorToHttp(new Error("boom"))).toBeUndefined();
    expect(mapPgErrorToHttp("nope")).toBeUndefined();
    expect(mapPgErrorToHttp(undefined)).toBeUndefined();
  });

  test("passes an already-mapped ORPCError through untouched (no double-map)", () => {
    const original = new ORPCError("CONFLICT", { message: "dup" });
    expect(mapPgErrorToHttp(original)).toBeUndefined();
  });

  test("does not leak the raw driver message to the client", () => {
    const mapped = mapPgErrorToHttp({
      code: "22001",
      message: 'value too long for column "secret_token"',
    });
    expect(mapped?.message).not.toContain("secret_token");
  });
});
