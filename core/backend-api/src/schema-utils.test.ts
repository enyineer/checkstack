import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { configString } from "./zod-config";
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
});
