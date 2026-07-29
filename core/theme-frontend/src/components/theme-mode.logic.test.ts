import { describe, expect, test } from "bun:test";
import type { Theme } from "@checkstack/ui";
import {
  getThemeModeOption,
  nextThemeMode,
  THEME_MODES,
} from "./theme-mode.logic";

describe("THEME_MODES", () => {
  test("offers all three modes, with system surfaced as Auto", () => {
    expect(THEME_MODES.map((m) => m.value)).toEqual([
      "light",
      "dark",
      "system",
    ]);
    expect(THEME_MODES.find((m) => m.value === "system")?.label).toBe("Auto");
  });
});

describe("getThemeModeOption", () => {
  test("returns the matching option", () => {
    expect(getThemeModeOption({ theme: "dark" }).label).toBe("Dark");
    expect(getThemeModeOption({ theme: "system" }).label).toBe("Auto");
  });
});

describe("nextThemeMode", () => {
  test("cycles light -> dark -> system -> light", () => {
    expect(nextThemeMode({ theme: "light" })).toBe("dark");
    expect(nextThemeMode({ theme: "dark" })).toBe("system");
    expect(nextThemeMode({ theme: "system" })).toBe("light");
  });

  test("the cycle reaches every mode and returns to the start", () => {
    // The regression this guards: the old toggle could leave `system` but never
    // return to it, so Auto was a one-way door.
    const seen: Theme[] = [];
    let theme: Theme = "light";
    for (let i = 0; i < THEME_MODES.length; i++) {
      seen.push(theme);
      theme = nextThemeMode({ theme });
    }

    expect(new Set(seen).size).toBe(THEME_MODES.length);
    expect(seen).toContain("system");
    expect(theme).toBe("light");
  });
});
