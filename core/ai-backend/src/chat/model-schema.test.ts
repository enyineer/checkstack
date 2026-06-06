import { describe, expect, test } from "bun:test";
import { tool as aiTool, asSchema } from "ai";
import { z } from "zod";
import {
  dateSafeModelSchema,
  coerceDateValues,
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
