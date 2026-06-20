import { describe, expect, it } from "bun:test";

import type { JsonSchema, JsonSchemaProperty } from "./types";
import {
  extractDefaults,
  getCleanDescription,
  isValueEmpty,
  nestedChildrenRequired,
  isFieldHiddenByCondition,
  NONE_SENTINEL,
  parseSelectValue,
  serializeFormData,
  parseFormData,
  detectEditorType,
  coerceNumberInput,
  isArrayItemNonTrivial,
  type EditorType,
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
    it("treats empty array as valid when no minItems specified", () => {
      expect(isValueEmpty([], arraySchema)).toBe(false);
    });

    it("treats empty array as empty when minItems > 0", () => {
      const requiredArraySchema: JsonSchemaProperty = { type: "array", minItems: 1 } as JsonSchemaProperty;
      expect(isValueEmpty([], requiredArraySchema)).toBe(true);
    });

    it("treats non-empty array as not empty", () => {
      expect(isValueEmpty([1, 2, 3], arraySchema)).toBe(false);
    });

    it("treats non-empty array as not empty even with minItems", () => {
      const requiredArraySchema: JsonSchemaProperty = { type: "array", minItems: 1 } as JsonSchemaProperty;
      expect(isValueEmpty([1], requiredArraySchema)).toBe(false);
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

describe("nestedChildrenRequired", () => {
  it("marks children of a REQUIRED object regardless of value", () => {
    expect(
      nestedChildrenRequired({ objectRequired: true, objectValue: undefined }),
    ).toBe(true);
    expect(
      nestedChildrenRequired({ objectRequired: true, objectValue: {} }),
    ).toBe(true);
  });

  it("does NOT mark children of an OPTIONAL object that is empty/unset", () => {
    // The spend-cap case: empty optional object -> no required `*`.
    expect(
      nestedChildrenRequired({ objectRequired: false, objectValue: undefined }),
    ).toBe(false);
    expect(
      nestedChildrenRequired({ objectRequired: false, objectValue: {} }),
    ).toBe(false);
    expect(
      nestedChildrenRequired({
        objectRequired: false,
        objectValue: { tokenBudget: "", windowMinutes: "" },
      }),
    ).toBe(false);
  });

  it("marks children of an OPTIONAL object once it is being provided", () => {
    // Operator started filling the cap -> guide completion with `*`.
    expect(
      nestedChildrenRequired({
        objectRequired: false,
        objectValue: { tokenBudget: 1000, windowMinutes: "" },
      }),
    ).toBe(true);
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

// =============================================================================
// Multi-Type Editor Utility Tests
// =============================================================================

describe("serializeFormData", () => {
  it("should serialize empty array to empty string", () => {
    expect(serializeFormData([])).toBe("");
  });

  it("should serialize single key-value pair", () => {
    expect(serializeFormData([{ key: "name", value: "John" }])).toBe(
      "name=John",
    );
  });

  it("should serialize multiple key-value pairs", () => {
    expect(
      serializeFormData([
        { key: "name", value: "John" },
        { key: "age", value: "30" },
      ]),
    ).toBe("name=John&age=30");
  });

  it("should URL-encode special characters", () => {
    expect(serializeFormData([{ key: "message", value: "Hello World!" }])).toBe(
      "message=Hello%20World!",
    );
  });

  it("should handle empty values", () => {
    expect(serializeFormData([{ key: "empty", value: "" }])).toBe("empty=");
  });

  it("should filter out entries with empty keys", () => {
    expect(
      serializeFormData([
        { key: "", value: "ignored" },
        { key: "valid", value: "kept" },
      ]),
    ).toBe("valid=kept");
  });

  it("should handle values with equals sign", () => {
    expect(serializeFormData([{ key: "expr", value: "a=b" }])).toBe(
      "expr=a%3Db",
    );
  });
});

describe("parseFormData", () => {
  it("should parse empty string to empty array", () => {
    expect(parseFormData("")).toEqual([]);
  });

  it("should parse whitespace-only string to empty array", () => {
    expect(parseFormData("   ")).toEqual([]);
  });

  it("should parse single key-value pair", () => {
    expect(parseFormData("name=John")).toEqual([
      { key: "name", value: "John" },
    ]);
  });

  it("should parse multiple key-value pairs", () => {
    expect(parseFormData("name=John&age=30")).toEqual([
      { key: "name", value: "John" },
      { key: "age", value: "30" },
    ]);
  });

  it("should URL-decode special characters", () => {
    expect(parseFormData("message=Hello%20World!")).toEqual([
      { key: "message", value: "Hello World!" },
    ]);
  });

  it("should handle empty values", () => {
    expect(parseFormData("empty=")).toEqual([{ key: "empty", value: "" }]);
  });

  it("should handle values with equals sign", () => {
    expect(parseFormData("expr=a%3Db")).toEqual([
      { key: "expr", value: "a=b" },
    ]);
  });

  it("should handle value containing literal equals", () => {
    expect(parseFormData("expr=a=b")).toEqual([{ key: "expr", value: "a=b" }]);
  });
});

describe("detectEditorType", () => {
  const allTypes: EditorType[] = ["none", "raw", "json", "formdata"];
  const withoutNone: EditorType[] = ["raw", "json", "formdata"];

  describe("empty/undefined values", () => {
    it("should return 'none' for undefined when available", () => {
      expect(detectEditorType(undefined, allTypes)).toBe("none");
    });

    it("should return 'raw' for undefined when 'none' not available", () => {
      expect(detectEditorType(undefined, withoutNone)).toBe("raw");
    });

    it("should return 'none' for empty string when available", () => {
      expect(detectEditorType("", allTypes)).toBe("none");
    });

    it("should return 'raw' for whitespace-only when 'none' not available", () => {
      expect(detectEditorType("   ", withoutNone)).toBe("raw");
    });
  });

  describe("JSON detection", () => {
    it("should detect valid JSON object", () => {
      expect(detectEditorType('{"key": "value"}', allTypes)).toBe("json");
    });

    it("should detect valid JSON array", () => {
      expect(detectEditorType("[1, 2, 3]", allTypes)).toBe("json");
    });

    it("should not detect invalid JSON", () => {
      expect(detectEditorType("{invalid json}", allTypes)).toBe("raw");
    });

    it("should not detect JSON when json type not available", () => {
      expect(detectEditorType('{"key": "value"}', ["raw", "formdata"])).toBe(
        "raw",
      );
    });
  });

  describe("formdata detection", () => {
    it("should detect key=value format", () => {
      expect(detectEditorType("name=John", allTypes)).toBe("formdata");
    });

    it("should detect multiple pairs", () => {
      expect(detectEditorType("name=John&age=30", allTypes)).toBe("formdata");
    });

    it("should not detect formdata with newlines", () => {
      expect(detectEditorType("name=John\nage=30", allTypes)).toBe("raw");
    });

    it("should not detect formdata when formdata type not available", () => {
      expect(detectEditorType("name=John", ["raw", "json"])).toBe("raw");
    });

    it("should prefer json over formdata for ambiguous content", () => {
      const jsonLikeFormdata = '{"name":"John"}';
      expect(detectEditorType(jsonLikeFormdata, allTypes)).toBe("json");
    });
  });

  describe("fallback behavior", () => {
    it("should fall back to raw for plain text", () => {
      expect(detectEditorType("Hello, world!", allTypes)).toBe("raw");
    });

    it("should fall back to first available type when raw not available", () => {
      expect(detectEditorType("Hello, world!", ["json", "formdata"])).toBe(
        "json",
      );
    });
  });
});

// =============================================================================
// Conditional Visibility Tests
// =============================================================================

describe("isFieldHiddenByCondition", () => {
  it("returns true when sibling value matches a value in the array", () => {
    const conditions = { authMode: ["datacenter"] };
    const formValues = { authMode: "datacenter" };
    expect(isFieldHiddenByCondition(conditions, formValues)).toBe(true);
  });

  it("returns true when sibling value matches any value in the array", () => {
    const conditions = { authMode: ["datacenter", "server"] };
    const formValues = { authMode: "server" };
    expect(isFieldHiddenByCondition(conditions, formValues)).toBe(true);
  });

  it("returns false when sibling value does not match", () => {
    const conditions = { authMode: ["datacenter"] };
    const formValues = { authMode: "cloud" };
    expect(isFieldHiddenByCondition(conditions, formValues)).toBe(false);
  });

  it("returns false when sibling field is missing (coerces to empty string)", () => {
    const conditions = { authMode: ["datacenter"] };
    const formValues = {};
    expect(isFieldHiddenByCondition(conditions, formValues)).toBe(false);
  });

  it("returns true when sibling field is missing and empty string is in the value list", () => {
    const conditions = { authMode: [""] };
    const formValues = {};
    expect(isFieldHiddenByCondition(conditions, formValues)).toBe(true);
  });

  it("handles multiple conditions with OR semantics (any match hides)", () => {
    const conditions = {
      authMode: ["datacenter"],
      environment: ["staging"],
    };
    // Only authMode matches
    expect(
      isFieldHiddenByCondition(conditions, {
        authMode: "datacenter",
        environment: "production",
      }),
    ).toBe(true);
    // Only environment matches
    expect(
      isFieldHiddenByCondition(conditions, {
        authMode: "cloud",
        environment: "staging",
      }),
    ).toBe(true);
    // Neither matches
    expect(
      isFieldHiddenByCondition(conditions, {
        authMode: "cloud",
        environment: "production",
      }),
    ).toBe(false);
  });

  it("returns false for empty conditions object", () => {
    expect(isFieldHiddenByCondition({}, { authMode: "cloud" })).toBe(false);
  });
});

describe("coerceNumberInput", () => {
  it("maps an empty input to undefined (not NaN)", () => {
    expect(coerceNumberInput({ raw: "", isInteger: false })).toBeUndefined();
    expect(coerceNumberInput({ raw: "", isInteger: true })).toBeUndefined();
  });

  it("maps a whitespace-only input to undefined", () => {
    expect(coerceNumberInput({ raw: "   ", isInteger: false })).toBeUndefined();
  });

  it("coerces a valid float", () => {
    expect(coerceNumberInput({ raw: "1.5", isInteger: false })).toBe(1.5);
  });

  it("coerces a valid integer", () => {
    expect(coerceNumberInput({ raw: "42", isInteger: true })).toBe(42);
  });

  it("truncates floats for integer fields via parseInt", () => {
    expect(coerceNumberInput({ raw: "3.9", isInteger: true })).toBe(3);
  });

  it("preserves zero", () => {
    expect(coerceNumberInput({ raw: "0", isInteger: true })).toBe(0);
  });

  it("preserves negative numbers", () => {
    expect(coerceNumberInput({ raw: "-7", isInteger: true })).toBe(-7);
    expect(coerceNumberInput({ raw: "-2.5", isInteger: false })).toBe(-2.5);
  });

  it("returns undefined for partially-typed values that don't parse", () => {
    expect(coerceNumberInput({ raw: "-", isInteger: true })).toBeUndefined();
    expect(coerceNumberInput({ raw: "-", isInteger: false })).toBeUndefined();
    expect(coerceNumberInput({ raw: "abc", isInteger: false })).toBeUndefined();
  });

  it("never returns NaN", () => {
    for (const raw of ["", " ", "-", ".", "e", "abc"]) {
      const float = coerceNumberInput({ raw, isInteger: false });
      const int = coerceNumberInput({ raw, isInteger: true });
      expect(Number.isNaN(float)).toBe(false);
      expect(Number.isNaN(int)).toBe(false);
    }
  });
});

describe("isArrayItemNonTrivial", () => {
  it("treats undefined/null as trivial", () => {
    expect(isArrayItemNonTrivial(undefined)).toBe(false);
    expect(isArrayItemNonTrivial(null)).toBe(false);
  });

  it("treats blank/whitespace strings as trivial", () => {
    expect(isArrayItemNonTrivial("")).toBe(false);
    expect(isArrayItemNonTrivial("   ")).toBe(false);
  });

  it("treats a non-empty string as non-trivial", () => {
    expect(isArrayItemNonTrivial("hello")).toBe(true);
  });

  it("treats numbers and booleans as deliberate values", () => {
    expect(isArrayItemNonTrivial(0)).toBe(true);
    expect(isArrayItemNonTrivial(false)).toBe(true);
  });

  it("treats an empty object (just-added row) as trivial", () => {
    expect(isArrayItemNonTrivial({})).toBe(false);
  });

  it("treats an object with only blank values as trivial", () => {
    expect(
      isArrayItemNonTrivial({ name: "", note: undefined, tags: [] }),
    ).toBe(false);
  });

  it("treats an object with any user-entered value as non-trivial", () => {
    expect(isArrayItemNonTrivial({ name: "", count: 3 })).toBe(true);
    expect(isArrayItemNonTrivial({ name: "x" })).toBe(true);
  });

  it("recurses into nested objects and arrays", () => {
    expect(isArrayItemNonTrivial({ nested: { value: "" } })).toBe(false);
    expect(isArrayItemNonTrivial({ nested: { value: "set" } })).toBe(true);
    expect(isArrayItemNonTrivial([{ a: "" }, { a: "" }])).toBe(false);
    expect(isArrayItemNonTrivial([{ a: "" }, { a: "x" }])).toBe(true);
  });
});
