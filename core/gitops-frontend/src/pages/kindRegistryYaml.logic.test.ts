import { describe, expect, test } from "bun:test";
import {
  buildAnnotation,
  generateSchemaYaml,
  generateYamlExample,
  isNullable,
  resolveEffective,
  scalarExample,
  type JsonSchemaProperty,
  type KindDescription,
} from "./kindRegistryYaml.logic";

function kind(props: Partial<KindDescription> = {}): KindDescription {
  return {
    apiVersion: "checkstack.io/v1",
    kind: "Widget",
    metadataSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    specSchema: { type: "object", properties: {} },
    extensions: [],
    ...props,
  };
}

describe("scalarExample", () => {
  test("renders enum members as a quoted union", () => {
    expect(scalarExample({ prop: { enum: ["a", "b"] } })).toBe('"a" | "b"');
  });

  test("default value wins over type and is JSON-encoded", () => {
    expect(scalarExample({ prop: { type: "string", default: "hello" } })).toBe(
      '"hello"',
    );
    expect(scalarExample({ prop: { type: "number", default: 42 } })).toBe("42");
  });

  test("type-based placeholders per scalar type", () => {
    expect(scalarExample({ prop: { type: "string" } })).toBe('"..."');
    expect(scalarExample({ prop: { type: "number" } })).toBe("0");
    expect(scalarExample({ prop: { type: "integer" } })).toBe("0");
    expect(scalarExample({ prop: { type: "boolean" } })).toBe("false");
    expect(scalarExample({ prop: { type: "array" } })).toBe("[]");
  });

  test("object without properties is annotated as a record", () => {
    expect(scalarExample({ prop: { type: "object" } })).toBe(
      "{} # key-value pairs",
    );
  });

  test("unknown type falls back to the string placeholder", () => {
    expect(scalarExample({ prop: {} })).toBe('"..."');
  });

  test("unwraps a nullable anyOf wrapper before deriving the example", () => {
    const prop: JsonSchemaProperty = {
      anyOf: [{ type: "number" }, { type: "null" }],
    };
    expect(scalarExample({ prop })).toBe("0");
  });
});

describe("resolveEffective", () => {
  test("unwraps a single non-null anyOf branch", () => {
    expect(
      resolveEffective({ prop: { anyOf: [{ type: "string" }, { type: "null" }] } }),
    ).toEqual({ type: "string" });
  });

  test("leaves multi-branch anyOf untouched", () => {
    const prop: JsonSchemaProperty = {
      anyOf: [{ type: "string" }, { type: "number" }],
    };
    expect(resolveEffective({ prop })).toBe(prop);
  });

  test("passes through a plain prop unchanged", () => {
    const prop: JsonSchemaProperty = { type: "boolean" };
    expect(resolveEffective({ prop })).toBe(prop);
  });
});

describe("isNullable", () => {
  test("true when an anyOf branch is null-typed", () => {
    expect(isNullable({ prop: { anyOf: [{ type: "string" }, { type: "null" }] } })).toBe(
      true,
    );
  });

  test("false for a non-null anyOf and for plain props", () => {
    expect(isNullable({ prop: { anyOf: [{ type: "string" }] } })).toBe(false);
    expect(isNullable({ prop: { type: "string" } })).toBe(false);
  });
});

describe("buildAnnotation", () => {
  test("required, non-nullable field gets no annotation", () => {
    expect(buildAnnotation({ prop: { type: "string" }, required: true })).toBe("");
  });

  test("optional field is tagged optional", () => {
    expect(buildAnnotation({ prop: { type: "string" }, required: false })).toBe(
      " # optional",
    );
  });

  test("optional and nullable are combined in order", () => {
    const prop: JsonSchemaProperty = {
      anyOf: [{ type: "string" }, { type: "null" }],
    };
    expect(buildAnnotation({ prop, required: false })).toBe(
      " # optional, nullable",
    );
  });

  test("required-but-nullable shows only nullable", () => {
    const prop: JsonSchemaProperty = {
      anyOf: [{ type: "string" }, { type: "null" }],
    };
    expect(buildAnnotation({ prop, required: true })).toBe(" # nullable");
  });
});

describe("generateSchemaYaml", () => {
  test("emits each property of an object schema with required/optional tags", () => {
    const yaml = generateSchemaYaml({
      type: "object",
      properties: {
        host: { type: "string" },
        port: { type: "number" },
      },
      required: ["host"],
    });
    expect(yaml).toBe('host: "..."\nport: 0 # optional');
  });

  test("non-object schema is emitted under a single value key", () => {
    expect(generateSchemaYaml({ type: "string" })).toBe('value: "..."');
  });

  test("placeholder comment when nothing renders", () => {
    expect(generateSchemaYaml({ type: "object", properties: {} })).toBe(
      "# No properties defined",
    );
  });

  test("nests object properties with two-space indentation", () => {
    const yaml = generateSchemaYaml({
      type: "object",
      properties: {
        auth: {
          type: "object",
          properties: { token: { type: "string" } },
          required: ["token"],
        },
      },
      required: ["auth"],
    });
    expect(yaml).toBe('auth:\n  token: "..."');
  });
});

describe("generateYamlExample", () => {
  test("renders apiVersion, kind, metadata name default, and empty spec", () => {
    const yaml = generateYamlExample({ kind: kind() });
    expect(yaml).toBe(
      [
        "apiVersion: checkstack.io/v1",
        "kind: Widget",
        "metadata:",
        '  name: "my-widget"',
        "spec: {}",
      ].join("\n"),
    );
  });

  test("renders base spec properties under spec:", () => {
    const yaml = generateYamlExample({
      kind: kind({
        specSchema: {
          type: "object",
          properties: { replicas: { type: "number" } },
          required: ["replicas"],
        },
      }),
    });
    expect(yaml).toContain("spec:");
    expect(yaml).toContain("  replicas: 0");
    expect(yaml).not.toContain("spec: {}");
  });

  test("appends extension namespaces as optional spec blocks", () => {
    const yaml = generateYamlExample({
      kind: kind({
        extensions: [
          {
            namespace: "monitoring",
            specSchema: {
              type: "object",
              properties: { enabled: { type: "boolean" } },
              required: ["enabled"],
            },
          },
        ],
      }),
    });
    expect(yaml).toContain("  monitoring: # optional");
    expect(yaml).toContain("    enabled: false");
  });

  test("variant selection swaps in the documented spec schema", () => {
    const documented = kind({
      specSchema: {
        type: "object",
        properties: { strategy: { type: "string" } },
        required: ["strategy"],
      },
      specSchemaDocumentation: [
        {
          fieldPath: "strategy",
          variantId: "rolling",
          label: "Rolling",
          specSchema: { type: "string", enum: ["rolling"] },
        },
      ],
    });
    const yaml = generateYamlExample({
      kind: documented,
      selections: { strategy: "rolling" },
    });
    // The collectorId/strategy special-case quotes the selected variant id.
    expect(yaml).toContain('  strategy: "rolling"');
  });
});
