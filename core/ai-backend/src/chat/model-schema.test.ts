import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  dateSafeModelSchema,
  coerceDateValues,
  schemaContainsDate,
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
