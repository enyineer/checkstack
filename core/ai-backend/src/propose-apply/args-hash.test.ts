import { describe, expect, test } from "bun:test";
import { hashToolArgs } from "./args-hash";

describe("hashToolArgs", () => {
  test("is stable across key order (canonical JSON)", () => {
    const a = hashToolArgs({ b: 2, a: 1, nested: { y: 1, x: 2 } });
    const b = hashToolArgs({ a: 1, nested: { x: 2, y: 1 }, b: 2 });
    expect(a).toBe(b);
  });

  test("preserves array order significance", () => {
    expect(hashToolArgs([1, 2, 3])).not.toBe(hashToolArgs([3, 2, 1]));
  });

  test("produces a 64-char hex SHA-256 digest", () => {
    expect(hashToolArgs({ x: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  test("different content hashes differently", () => {
    expect(hashToolArgs({ x: 1 })).not.toBe(hashToolArgs({ x: 2 }));
  });

  test("ignores undefined properties (treated as absent)", () => {
    expect(hashToolArgs({ x: 1, y: undefined })).toBe(hashToolArgs({ x: 1 }));
  });
});
