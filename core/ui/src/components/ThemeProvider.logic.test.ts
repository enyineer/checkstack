import { describe, expect, test } from "bun:test";
import { parseStoredTheme, resolveTheme } from "./ThemeProvider.logic";

describe("resolveTheme", () => {
  test("an explicit choice ignores the OS preference entirely", () => {
    expect(resolveTheme({ theme: "light", systemPrefersDark: true })).toBe(
      "light",
    );
    expect(resolveTheme({ theme: "dark", systemPrefersDark: false })).toBe(
      "dark",
    );
  });

  test("system follows the OS preference in both directions", () => {
    expect(resolveTheme({ theme: "system", systemPrefersDark: true })).toBe(
      "dark",
    );
    expect(resolveTheme({ theme: "system", systemPrefersDark: false })).toBe(
      "light",
    );
  });

  test("the same stored choice resolves differently as the OS flips", () => {
    // This is the whole point of Auto: one persisted value, two outcomes.
    const theme = "system" as const;
    expect(resolveTheme({ theme, systemPrefersDark: false })).toBe("light");
    expect(resolveTheme({ theme, systemPrefersDark: true })).toBe("dark");
  });
});

describe("parseStoredTheme", () => {
  test("accepts every valid stored theme, system included", () => {
    for (const value of ["light", "dark", "system"] as const) {
      expect(parseStoredTheme({ value, fallback: "light" })).toBe(value);
    }
  });

  test("falls back when nothing is stored", () => {
    expect(parseStoredTheme({ value: null, fallback: "system" })).toBe("system");
  });

  test("falls back on an unrecognised value rather than trusting it", () => {
    // localStorage is user-writable; a bogus value must not reach the <html>
    // class list.
    expect(parseStoredTheme({ value: "neon", fallback: "system" })).toBe(
      "system",
    );
    expect(parseStoredTheme({ value: "", fallback: "dark" })).toBe("dark");
  });
});
