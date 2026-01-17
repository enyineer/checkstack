import { describe, expect, it } from "bun:test";

import type { JsonSchema, JsonSchemaProperty } from "./types";
import {
  extractDefaults,
  getCleanDescription,
  isValueEmpty,
  NONE_SENTINEL,
  parseSelectValue,
} from "./utils";

describe("getCleanDescription", () => {
  it("returns undefined for empty string", () => {
    expect(getCleanDescription("")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(getCleanDescription(undefined)).toBeUndefined();
  });

  it("returns undefined for 'textarea' marker only", () => {
    expect(getCleanDescription("textarea")).toBeUndefined();
  });

  it("removes [textarea] marker from description", () => {
    expect(getCleanDescription("[textarea] Some description")).toBe(
      "Some description",
    );
  });

  it("returns cleaned description without marker", () => {
    expect(getCleanDescription("Regular description")).toBe(
      "Regular description",
    );
  });

  it("trims whitespace after removing marker", () => {
    expect(getCleanDescription("  [textarea]  Description  ")).toBe(
      "Description",
    );
  });
});

describe("extractDefaults", () => {
  it("returns empty object for schema without properties", () => {
    const schema: JsonSchema = {};
    expect(extractDefaults(schema)).toEqual({});
  });

  it("extracts simple default values", () => {
    const schema: JsonSchema = {
      properties: {
        name: { type: "string", default: "default name" },
        count: { type: "number", default: 0 },
        enabled: { type: "boolean", default: true },
      },
    };
    expect(extractDefaults(schema)).toEqual({
      name: "default name",
      count: 0,
      enabled: true,
    });
  });

  it("defaults arrays to empty array", () => {
    const schema: JsonSchema = {
      properties: {
        items: { type: "array" },
      },
    };
    expect(extractDefaults(schema)).toEqual({
      items: [],
    });
  });

  it("recursively extracts defaults from nested objects", () => {
    const schema: JsonSchema = {
      properties: {
        config: {
          type: "object",
          properties: {
            setting1: { type: "string", default: "value1" },
            setting2: { type: "number", default: 42 },
          },
        },
      },
    };
    expect(extractDefaults(schema)).toEqual({
      config: {
        setting1: "value1",
        setting2: 42,
      },
    });
  });

  it("ignores properties without defaults", () => {
    const schema: JsonSchema = {
      properties: {
        withDefault: { type: "string", default: "has default" },
        withoutDefault: { type: "string" },
      },
    };
    expect(extractDefaults(schema)).toEqual({
      withDefault: "has default",
    });
  });
});

describe("isValueEmpty", () => {
  const stringSchema: JsonSchemaProperty = { type: "string" };
  const numberSchema: JsonSchemaProperty = { type: "number" };
  const arraySchema: JsonSchemaProperty = { type: "array" };
  const objectSchema: JsonSchemaProperty = {
    type: "object",
    properties: {
      requiredField: { type: "string" },
      optionalField: { type: "string" },
    },
    required: ["requiredField"],
  };

  describe("primitive values", () => {
    it("treats undefined as empty", () => {
      expect(isValueEmpty(undefined, stringSchema)).toBe(true);
    });

    it("treats null as empty", () => {
      expect(isValueEmpty(null, stringSchema)).toBe(true);
    });

    it("treats empty string as empty", () => {
      expect(isValueEmpty("", stringSchema)).toBe(true);
    });

    it("treats whitespace-only string as empty", () => {
      expect(isValueEmpty("   ", stringSchema)).toBe(true);
    });

    it("treats non-empty string as not empty", () => {
      expect(isValueEmpty("hello", stringSchema)).toBe(false);
    });

    it("treats zero as not empty", () => {
      expect(isValueEmpty(0, numberSchema)).toBe(false);
    });

    it("treats false as not empty", () => {
      const boolSchema: JsonSchemaProperty = { type: "boolean" };
      expect(isValueEmpty(false, boolSchema)).toBe(false);
    });
  });

  describe("arrays", () => {
    it("treats empty array as empty", () => {
      expect(isValueEmpty([], arraySchema)).toBe(true);
    });

    it("treats non-empty array as not empty", () => {
      expect(isValueEmpty([1, 2, 3], arraySchema)).toBe(false);
    });
  });

  describe("objects", () => {
    it("treats object with empty required field as empty", () => {
      expect(isValueEmpty({ requiredField: "" }, objectSchema)).toBe(true);
    });

    it("treats object with filled required field as not empty", () => {
      expect(isValueEmpty({ requiredField: "value" }, objectSchema)).toBe(
        false,
      );
    });

    it("ignores optional fields when checking emptiness", () => {
      expect(
        isValueEmpty(
          { requiredField: "value", optionalField: "" },
          objectSchema,
        ),
      ).toBe(false);
    });

    it("treats object with missing required field as empty", () => {
      expect(isValueEmpty({ optionalField: "value" }, objectSchema)).toBe(true);
    });
  });
});

describe("NONE_SENTINEL", () => {
  it("is a specific string constant", () => {
    expect(NONE_SENTINEL).toBe("__none__");
  });
});

describe("parseSelectValue", () => {
  it("returns undefined for NONE_SENTINEL", () => {
    expect(parseSelectValue(NONE_SENTINEL)).toBeUndefined();
  });

  it("returns undefined for '__none__' string", () => {
    expect(parseSelectValue("__none__")).toBeUndefined();
  });

  it("returns the value as-is for regular strings", () => {
    expect(parseSelectValue("some-role-id")).toBe("some-role-id");
  });

  it("returns empty string as-is", () => {
    expect(parseSelectValue("")).toBe("");
  });

  it("returns whitespace as-is", () => {
    expect(parseSelectValue("  ")).toBe("  ");
  });
});
