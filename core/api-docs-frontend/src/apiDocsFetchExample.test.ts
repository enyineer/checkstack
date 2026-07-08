import { describe, expect, test } from "bun:test";
import {
  generateFetchExample,
  schemaToExampleValue,
  type OpenApiSpec,
  type OperationObject,
} from "./apiDocsFetchExample";

function makeSpec(overrides: Partial<OpenApiSpec> = {}): OpenApiSpec {
  return {
    info: { title: "Test API", version: "1.0.0" },
    paths: {},
    ...overrides,
  };
}

describe("generateFetchExample - base URL", () => {
  test("uses servers[0].url and strips a trailing slash", () => {
    const spec = makeSpec({ servers: [{ url: "https://api.example.com/" }] });
    const operation: OperationObject = {};
    const output = generateFetchExample({
      path: "/rest/catalog/getEntities",
      method: "get",
      operation,
      spec,
    });
    expect(output).toContain(
      'fetch("https://api.example.com/rest/catalog/getEntities"',
    );
    expect(output).not.toContain("//rest");
  });

  test("falls back to a relative path when servers is absent", () => {
    const spec = makeSpec();
    const output = generateFetchExample({
      path: "/rest/catalog/getEntities",
      method: "get",
      operation: {},
      spec,
    });
    expect(output).toContain('fetch("/rest/catalog/getEntities"');
  });
});

describe("generateFetchExample - query params", () => {
  test("substitutes a schema example value, URL-encoded", () => {
    const spec = makeSpec();
    const operation: OperationObject = {
      parameters: [
        {
          name: "q",
          in: "query",
          required: true,
          schema: { type: "string", example: "hello world" },
        },
      ],
    };
    const output = generateFetchExample({
      path: "/rest/search",
      method: "get",
      operation,
      spec,
    });
    expect(output).toContain("?q=hello%20world");
  });

  test("prefers default, then enum[0]", () => {
    const spec = makeSpec();
    const operation: OperationObject = {
      parameters: [
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", default: 25 },
        },
        {
          name: "sort",
          in: "query",
          schema: { type: "string", enum: ["asc", "desc"] },
        },
      ],
    };
    const output = generateFetchExample({
      path: "/rest/list",
      method: "get",
      operation,
      spec,
    });
    expect(output).toContain("limit=25");
    expect(output).toContain("sort=asc");
  });

  test("falls back to a placeholder when the schema supplies nothing", () => {
    const spec = makeSpec();
    const operation: OperationObject = {
      parameters: [
        { name: "id", in: "query", required: true, schema: { type: "string" } },
        { name: "opt", in: "query", required: false, schema: { type: "string" } },
      ],
    };
    const output = generateFetchExample({
      path: "/rest/get",
      method: "get",
      operation,
      spec,
    });
    expect(output).toContain("id=<required>");
    expect(output).toContain("opt=<optional>");
  });
});

describe("generateFetchExample - body", () => {
  test("renders a realistic example object for a non-GET body", () => {
    const spec = makeSpec();
    const operation: OperationObject = {
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                count: { type: "integer" },
                active: { type: "boolean" },
              },
            },
          },
        },
      },
    };
    const output = generateFetchExample({
      path: "/rest/create",
      method: "post",
      operation,
      spec,
    });
    expect(output).toContain('method: "POST"');
    expect(output).toContain('"Content-Type": "application/json"');
    expect(output).toContain("body: JSON.stringify(");
    expect(output).toContain('"name": "string"');
    expect(output).toContain('"count": 0');
    expect(output).toContain('"active": true');
    // The serialized body must be valid JS: no placeholder comment.
    expect(output).not.toContain("see schema above");
  });

  test("GET requests emit no body and no Content-Type header", () => {
    const spec = makeSpec();
    const output = generateFetchExample({
      path: "/rest/get",
      method: "get",
      operation: {},
      spec,
    });
    expect(output).not.toContain("body: JSON.stringify");
    expect(output).not.toContain("Content-Type");
  });
});

describe("schemaToExampleValue", () => {
  test("resolves a $ref against components.schemas", () => {
    const spec = makeSpec({
      components: {
        schemas: {
          Point: {
            type: "object",
            properties: { x: { type: "integer" }, y: { type: "integer" } },
          },
        },
      },
    });
    const value = schemaToExampleValue({
      schema: { $ref: "#/components/schemas/Point" },
      spec,
    });
    expect(value).toEqual({ x: 0, y: 0 });
  });

  test("uses enum[0] for an enum schema", () => {
    const spec = makeSpec();
    const value = schemaToExampleValue({
      schema: { type: "string", enum: ["red", "green", "blue"] },
      spec,
    });
    expect(value).toBe("red");
  });

  test("emits a single-element array from items, including nested refs", () => {
    const spec = makeSpec({
      components: {
        schemas: {
          Tag: {
            type: "object",
            properties: { label: { type: "string" } },
          },
        },
      },
    });
    const value = schemaToExampleValue({
      schema: {
        type: "array",
        items: { $ref: "#/components/schemas/Tag" },
      },
      spec,
    });
    expect(value).toEqual([{ label: "string" }]);
  });

  test("picks the first variant of a oneOf", () => {
    const spec = makeSpec();
    const value = schemaToExampleValue({
      schema: {
        oneOf: [{ type: "string" }, { type: "integer" }],
      },
      spec,
    });
    expect(value).toBe("string");
  });

  test("merges object variants of an allOf", () => {
    const spec = makeSpec();
    const value = schemaToExampleValue({
      schema: {
        allOf: [
          { type: "object", properties: { a: { type: "string" } } },
          { type: "object", properties: { b: { type: "boolean" } } },
        ],
      },
      spec,
    });
    expect(value).toEqual({ a: "string", b: true });
  });

  test("guards against a self-referential $ref without infinite looping", () => {
    const spec = makeSpec({
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: {
              value: { type: "string" },
              next: { $ref: "#/components/schemas/Node" },
            },
          },
        },
      },
    });
    const value = schemaToExampleValue({
      schema: { $ref: "#/components/schemas/Node" },
      spec,
    });
    // First level resolves; the recursive `next` short-circuits to null.
    expect(value).toEqual({ value: "string", next: null });
  });

  test("returns null for an unresolvable $ref", () => {
    const spec = makeSpec();
    const value = schemaToExampleValue({
      schema: { $ref: "#/components/schemas/Missing" },
      spec,
    });
    expect(value).toBeNull();
  });
});
