import { describe, it, expect } from "bun:test";
import { isBackendWritable } from "./secret-backend";

describe("isBackendWritable", () => {
  it("is true only when BOTH set and delete are implemented", () => {
    expect(
      isBackendWritable({ backend: { set: async () => {}, delete: async () => {} } }),
    ).toBe(true);
  });

  it("is false for a read-through backend (neither set nor delete)", () => {
    expect(isBackendWritable({ backend: {} })).toBe(false);
  });

  it("is false when only one of set / delete is implemented", () => {
    expect(isBackendWritable({ backend: { set: async () => {} } })).toBe(false);
    expect(isBackendWritable({ backend: { delete: async () => {} } })).toBe(
      false,
    );
  });
});
