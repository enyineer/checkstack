import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { configString, withConfigMeta } from "./zod-config";
import { toJsonSchema } from "./schema-utils";

describe("toJsonSchema x-* metadata", () => {
  test("propagates x-script-testable and x-editor-types onto the field", () => {
    const schema = z.object({
      script: configString({
        "x-editor-types": ["typescript"],
        "x-script-testable": true,
      }),
    });

    const json = toJsonSchema(schema) as {
      properties: Record<string, Record<string, unknown>>;
    };

    expect(json.properties.script?.["x-script-testable"]).toBe(true);
    expect(json.properties.script?.["x-editor-types"]).toEqual(["typescript"]);
  });

  test("omits x-script-testable when not set", () => {
    const schema = z.object({
      plain: configString({}),
    });
    const json = toJsonSchema(schema) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect("x-script-testable" in (json.properties.plain ?? {})).toBe(false);
  });

  test("propagates x-secret-env onto a record field via withConfigMeta", () => {
    const schema = z.object({
      secretEnv: withConfigMeta(z.record(z.string(), z.string()), {
        "x-secret-env": true,
      }),
    });
    const json = toJsonSchema(schema) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(json.properties.secretEnv?.["x-secret-env"]).toBe(true);
  });
});

describe("toJsonSchema unrepresentable types", () => {
  // Regression: Zod v4 throws "Date cannot be represented in JSON Schema" for
  // `z.date()` by default. This converter feeds the OpenAPI generator AND the
  // AI tool projection, so a single date field (timestamps are everywhere)
  // would crash the whole AI chat. Dates must serialize as date-time strings.
  test("represents z.date() as a date-time string instead of throwing", () => {
    const schema = z.object({
      createdAt: z.date(),
      note: z.string(),
    });

    const json = toJsonSchema(schema) as {
      properties: Record<string, Record<string, unknown>>;
    };

    expect(json.properties.createdAt?.type).toBe("string");
    expect(json.properties.createdAt?.format).toBe("date-time");
    expect(json.properties.note?.type).toBe("string");
  });

  test("handles a top-level / optional / array date without throwing", () => {
    expect(() => toJsonSchema(z.date())).not.toThrow();
    const json = toJsonSchema(
      z.object({ seen: z.array(z.date()), at: z.date().optional() }),
    ) as { properties: Record<string, Record<string, unknown>> };
    expect(
      (json.properties.seen?.items as Record<string, unknown> | undefined)
        ?.format,
    ).toBe("date-time");
    expect(json.properties.at?.format).toBe("date-time");
  });
});
