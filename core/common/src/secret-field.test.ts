import { describe, expect, it } from "bun:test";
import { SECRET_CLEAR_SENTINEL, isSecretClearSentinel } from "./secret-field";

describe("isSecretClearSentinel", () => {
  it("recognizes the exact sentinel", () => {
    expect(isSecretClearSentinel(SECRET_CLEAR_SENTINEL)).toBe(true);
  });

  it("rejects ordinary secret values and blanks", () => {
    expect(isSecretClearSentinel("")).toBe(false);
    expect(isSecretClearSentinel("hunter2")).toBe(false);
    expect(isSecretClearSentinel("${{ secrets.TOKEN }}")).toBe(false);
    expect(isSecretClearSentinel(undefined)).toBe(false);
    expect(isSecretClearSentinel(null)).toBe(false);
  });

  it("does not collide after trimming (leading NUL is not whitespace)", () => {
    // The value must survive a `.trim()`-based emptiness check unchanged so it
    // is never mistaken for a blank keep-existing field.
    expect(SECRET_CLEAR_SENTINEL.trim()).toBe(SECRET_CLEAR_SENTINEL);
    expect(SECRET_CLEAR_SENTINEL.length).toBeGreaterThan(0);
  });
});
