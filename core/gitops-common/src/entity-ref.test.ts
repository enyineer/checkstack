import { describe, expect, it } from "bun:test";
import {
  entityRefSchema,
  extractEntityRefs,
  type EntityRef,
} from "./entity-ref";

describe("entityRefSchema", () => {
  it("validates a well-formed entity ref", () => {
    const result = entityRefSchema.safeParse({
      kind: "Healthcheck",
      name: "payment-db-check",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing kind", () => {
    const result = entityRefSchema.safeParse({ name: "foo" });
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const result = entityRefSchema.safeParse({ kind: "System" });
    expect(result.success).toBe(false);
  });

  it("rejects empty kind", () => {
    const result = entityRefSchema.safeParse({ kind: "", name: "foo" });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = entityRefSchema.safeParse({ kind: "System", name: "" });
    expect(result.success).toBe(false);
  });
});

describe("extractEntityRefs", () => {
  it("extracts a single ref from a flat object", () => {
    const spec = {
      ref: { kind: "Healthcheck", name: "db-check" },
    };
    const refs = extractEntityRefs(spec);
    expect(refs).toEqual([{ kind: "Healthcheck", name: "db-check" }]);
  });

  it("extracts multiple refs from an array", () => {
    const spec = {
      healthchecks: [
        { ref: { kind: "Healthcheck", name: "db-check" } },
        { ref: { kind: "Healthcheck", name: "api-check" } },
      ],
    };
    const refs = extractEntityRefs(spec);
    expect(refs).toEqual([
      { kind: "Healthcheck", name: "db-check" },
      { kind: "Healthcheck", name: "api-check" },
    ]);
  });

  it("extracts refs from deeply nested structures", () => {
    const spec = {
      level1: {
        level2: {
          level3: { kind: "System", name: "nested-sys" },
        },
      },
    };
    const refs = extractEntityRefs(spec);
    expect(refs).toEqual([{ kind: "System", name: "nested-sys" }]);
  });

  it("ignores objects with non-string kind or name", () => {
    const spec = {
      notARef1: { kind: 123, name: "foo" },
      notARef2: { kind: "System", name: 456 },
      notARef3: { kind: true, name: false },
    };
    const refs = extractEntityRefs(spec);
    expect(refs).toEqual([]);
  });

  it("ignores objects with empty kind or name", () => {
    const spec = {
      emptyKind: { kind: "", name: "foo" },
      emptyName: { kind: "System", name: "" },
    };
    const refs = extractEntityRefs(spec);
    expect(refs).toEqual([]);
  });

  it("ignores primitives, nulls, and strings", () => {
    const spec = {
      str: "just a string",
      num: 42,
      bool: true,
      nil: null,
    };
    const refs = extractEntityRefs(spec);
    expect(refs).toEqual([]);
  });

  it("does not recurse into matched refs (no double-counting)", () => {
    const ref: EntityRef = { kind: "Healthcheck", name: "db-check" };
    const spec = { ref };
    const refs = extractEntityRefs(spec);
    // Should find exactly one ref, not recurse into it
    expect(refs).toHaveLength(1);
  });

  it("handles mixed valid and invalid entries", () => {
    const spec = {
      items: [
        { ref: { kind: "Healthcheck", name: "valid" } },
        { ref: "invalid-string" },
        { ref: { kind: "System", name: "also-valid" } },
        { ref: null },
      ],
    };
    const refs = extractEntityRefs(spec);
    expect(refs).toEqual([
      { kind: "Healthcheck", name: "valid" },
      { kind: "System", name: "also-valid" },
    ]);
  });
});
