import { describe, expect, test } from "bun:test";
import { tool as aiTool, asSchema } from "ai";
import { z } from "zod";
import {
  dateSafeModelSchema,
  coerceDateValues,
  collectDateOffsetIssues,
  schemaContainsDate,
  toModelSchema,
} from "./model-schema";

describe("schemaContainsDate", () => {
  test("detects dates in object / array / optional / coerce positions", () => {
    expect(schemaContainsDate(z.object({ at: z.date() }))).toBe(true);
    expect(schemaContainsDate(z.object({ at: z.date().optional() }))).toBe(true);
    expect(schemaContainsDate(z.object({ at: z.coerce.date() }))).toBe(true);
    expect(schemaContainsDate(z.object({ seen: z.array(z.date()) }))).toBe(true);
    expect(
      schemaContainsDate(z.object({ d: z.date() }).refine(() => true)),
    ).toBe(true);
  });

  test("returns false when there is no date", () => {
    expect(
      schemaContainsDate(z.object({ name: z.string(), n: z.number() })),
    ).toBe(false);
  });
});

describe("coerceDateValues", () => {
  test("coerces ISO strings to Date only at date positions", () => {
    const schema = z.object({ at: z.date(), name: z.string() });
    const out = coerceDateValues(
      { at: "2026-01-02T03:04:05.000Z", name: "2026-01-02T03:04:05.000Z" },
      schema,
    ) as { at: unknown; name: unknown };
    expect(out.at).toBeInstanceOf(Date);
    // A string field that merely looks like a date is left a string.
    expect(out.name).toBe("2026-01-02T03:04:05.000Z");
  });

  test("recurses arrays and optionals", () => {
    const schema = z.object({
      seen: z.array(z.date()),
      at: z.date().optional(),
    });
    const out = coerceDateValues(
      { seen: ["2026-01-02T00:00:00.000Z"], at: undefined },
      schema,
    ) as { seen: unknown[]; at: unknown };
    expect(out.seen[0]).toBeInstanceOf(Date);
    expect(out.at).toBeUndefined();
  });
});

describe("dateSafeModelSchema", () => {
  // The core regression: the AI SDK would throw "Date cannot be represented in
  // JSON Schema" building the model-facing schema for these inputs.
  test("produces a date-time string schema without throwing", async () => {
    const schema = dateSafeModelSchema(
      z.object({ id: z.string(), createdAt: z.date() }),
    );
    const js = (await schema.jsonSchema) as {
      properties: Record<string, Record<string, unknown>>;
      additionalProperties?: unknown;
    };
    expect(js.properties.createdAt?.type).toBe("string");
    expect(js.properties.createdAt?.format).toBe("date-time");
    // The model is told the offset contract right on the field.
    expect(String(js.properties.createdAt?.description)).toContain(
      "explicit timezone offset",
    );
    // Strict-provider friendly (matches the SDK's own zod adapter).
    expect(js.additionalProperties).toBe(false);
  });

  test("validator coerces the model's ISO string into a Date", async () => {
    const schema = dateSafeModelSchema(z.object({ at: z.date() }));
    const result = await schema.validate?.({ at: "2026-01-02T03:04:05.000Z" });
    expect(result?.success).toBe(true);
    if (result?.success) {
      expect((result.value as { at: Date }).at).toBeInstanceOf(Date);
    }
  });

  test("validator preserves the original schema's refinement", async () => {
    const schema = dateSafeModelSchema(
      z
        .object({ startAt: z.coerce.date(), endAt: z.coerce.date() })
        .refine((v) => v.endAt > v.startAt, { message: "endAt after startAt" }),
    );
    const bad = await schema.validate?.({
      startAt: "2026-01-02T00:00:00.000Z",
      endAt: "2026-01-01T00:00:00.000Z",
    });
    expect(bad?.success).toBe(false);
  });
});

describe("date format matrix (the wire contract)", () => {
  // Run every case through BOTH a raw `z.date()` (which exercises OUR coercion)
  // and a `z.coerce.date()` (whose own `new Date()` coercion is lenient and
  // MUST still be gated). A model can emit any of these shapes; the contract is:
  // only an RFC 3339 date-time WITH an explicit offset is accepted, and it maps
  // to the one unambiguous instant. Zone-less, date-only, numeric and garbage
  // values are rejected so the model self-repairs instead of us guessing a zone.
  const schemas = {
    "z.date()": z.object({ at: z.date() }),
    "z.coerce.date()": z.object({ at: z.coerce.date() }),
  };

  // Offset-bearing inputs and the single UTC instant they must resolve to.
  // Deterministic regardless of the machine's local timezone (each carries Z or
  // an explicit offset), so the exact ISO is safe to assert in CI.
  const accepted: Array<[input: string, iso: string]> = [
    ["2026-07-01T22:00:00.000Z", "2026-07-01T22:00:00.000Z"],
    ["2026-07-01T22:00:00Z", "2026-07-01T22:00:00.000Z"],
    ["2026-07-01T22:00Z", "2026-07-01T22:00:00.000Z"], // no seconds
    ["2026-07-01T22:00:00.123Z", "2026-07-01T22:00:00.123Z"], // sub-seconds
    ["2026-07-01T22:00:00+00:00", "2026-07-01T22:00:00.000Z"],
    ["2026-07-01T22:00:00+02:00", "2026-07-01T20:00:00.000Z"],
    ["2026-07-01T22:00:00-05:00", "2026-07-02T03:00:00.000Z"],
    ["2026-07-01T22:00:00+0200", "2026-07-01T20:00:00.000Z"], // offset w/o colon
  ];

  // Rejected: zone-less (would be interpreted server-local), date-only (drops
  // the time), non-ISO human forms, and outright garbage.
  const rejected = [
    "2026-07-01T22:00:00", // no offset
    "2026-07-01 22:00:00", // space + no offset
    "2026-07-01", // date only
    "2026/07/01", // slashes
    "July 1, 2026", // human
    "Wed, 01 Jul 2026 22:00:00 GMT", // RFC 1123 (no offset designator we accept)
    "2026-13-01T00:00:00Z", // matches the offset shape but is not a real date
    "not a date",
    "",
    "tomorrow",
  ];

  for (const [label, schema] of Object.entries(schemas)) {
    for (const [input, iso] of accepted) {
      test(`${label}: accepts "${input}" -> ${iso}`, async () => {
        const result = await dateSafeModelSchema(schema).validate?.({
          at: input,
        });
        expect(result?.success).toBe(true);
        if (result?.success) {
          const at = (result.value as { at: Date }).at;
          expect(at).toBeInstanceOf(Date);
          expect(at.toISOString()).toBe(iso);
        }
      });
    }

    for (const input of rejected) {
      test(`${label}: rejects ${JSON.stringify(input)}`, async () => {
        const result = await dateSafeModelSchema(schema).validate?.({
          at: input,
        });
        expect(result?.success).toBe(false);
      });
    }

    test(`${label}: rejects a bare epoch number`, async () => {
      const result = await dateSafeModelSchema(schema).validate?.({
        at: 1782000000000,
      });
      expect(result?.success).toBe(false);
    });
  }

  test("rejection message names the field and the offset requirement", () => {
    const issues = collectDateOffsetIssues(
      { startAt: "2026-07-01T22:00:00" },
      z.object({ startAt: z.date() }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("startAt");
    expect(issues[0]).toContain("explicit timezone offset");
  });

  test("a regex-shaped but impossible date reports an invalid-date message", () => {
    const issues = collectDateOffsetIssues(
      { at: "2026-13-01T00:00:00Z" },
      z.object({ at: z.date() }),
    );
    expect(issues[0]).toContain("not a valid calendar date-time");
  });

  test("nested arrays and optionals are gated too", () => {
    const schema = z.object({
      windows: z.array(z.object({ at: z.date() })),
      maybe: z.date().optional(),
    });
    const issues = collectDateOffsetIssues(
      { windows: [{ at: "2026-07-01" }], maybe: "2026-07-01T00:00:00" },
      schema,
    );
    expect(issues).toHaveLength(2);
    expect(issues.some((m) => m.includes("windows[0].at"))).toBe(true);
    expect(issues.some((m) => m.includes("maybe"))).toBe(true);
  });

  test("an absent optional date is not flagged", () => {
    expect(
      collectDateOffsetIssues({}, z.object({ at: z.date().optional() })),
    ).toEqual([]);
  });
});

describe("toModelSchema (the single boundary entry)", () => {
  test("returns the raw Zod schema when there is no date", () => {
    const schema = z.object({ q: z.string() });
    expect(toModelSchema(schema)).toBe(schema);
  });

  test("returns a date-safe Schema when a date is present", () => {
    const schema = z.object({ at: z.date() });
    expect(toModelSchema(schema)).not.toBe(schema);
  });

  // The full inbound round-trip exactly as the AI SDK runtime drives it: the
  // model emits an object with an ISO date STRING, the tool's inputSchema
  // validates it, and `execute` is called with the validated value. We assert
  // `execute` receives a real `Date` - i.e. the model can create date-bearing
  // objects and they are parsed back to Date in our backend. Uses a raw
  // `z.date()` (not coerce.date) so this proves OUR coercion, not Zod's.
  //
  // The input string is the EXACT shape a real model emits, captured from a
  // live deepseek-v4-flash maintenance-window creation: ISO 8601 with a `Z`
  // offset and NO milliseconds (`...T22:00:00Z`, not `...T22:00:00.000Z`). The
  // less-precise form is what providers actually return, so the test asserts
  // `new Date()` normalizes it to a real Date with the milliseconds filled in.
  test("model's ISO date object (no millis) is parsed to a real Date for execute", async () => {
    const schema = z.object({ startAt: z.date(), label: z.string() });
    let received: { startAt: unknown; label: unknown } | undefined;
    const t = aiTool({
      inputSchema: toModelSchema(schema) as never,
      execute: async (input: unknown) => {
        received = input as { startAt: unknown; label: unknown };
        return { ok: true };
      },
    });

    const validated = await asSchema(t.inputSchema).validate?.({
      startAt: "2026-07-01T22:00:00Z",
      label: "window",
    });
    expect(validated?.success).toBe(true);
    if (validated?.success) {
      await t.execute?.(validated.value, {
        toolCallId: "call-1",
        messages: [],
      });
    }

    expect(received?.startAt).toBeInstanceOf(Date);
    expect((received?.startAt as Date).toISOString()).toBe(
      "2026-07-01T22:00:00.000Z",
    );
    expect(received?.label).toBe("window");
  });
});
