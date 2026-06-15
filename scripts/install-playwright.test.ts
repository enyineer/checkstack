import { describe, expect, test } from "bun:test";
import { resolvePlaywrightVersion } from "./install-playwright";

describe("resolvePlaywrightVersion", () => {
  test("extracts the single resolved playwright version", () => {
    const lock = `
      "@playwright/test": ["@playwright/test@1.60.0", "", { "dependencies": { "playwright": "1.60.0" } }, "sha512-a"],
      "playwright": ["playwright@1.60.0", "", { "dependencies": { "playwright-core": "1.60.0" } }, "sha512-b"],
      "playwright-core": ["playwright-core@1.60.0", "", {}, "sha512-c"],
    `;
    expect(resolvePlaywrightVersion({ lockfileText: lock })).toBe("1.60.0");
  });

  test("does not confuse playwright-core or @playwright/test for playwright", () => {
    const lock = `
      "@playwright/test": ["@playwright/test@1.55.0", "", {}, "sha512-a"],
      "playwright-core": ["playwright-core@1.55.0", "", {}, "sha512-c"],
    `;
    expect(() => resolvePlaywrightVersion({ lockfileText: lock })).toThrow(
      /Could not find a resolved/,
    );
  });

  test("throws when the graph resolved more than one playwright version", () => {
    const lock = `
      "a/playwright": ["playwright@1.60.0", "", {}, "sha512-b"],
      "b/playwright": ["playwright@1.59.0", "", {}, "sha512-d"],
    `;
    expect(() => resolvePlaywrightVersion({ lockfileText: lock })).toThrow(
      /multiple playwright versions/,
    );
  });

  test("dedupes identical versions appearing under multiple parents", () => {
    const lock = `
      "playwright": ["playwright@1.60.0", "", {}, "sha512-b"],
      "x/playwright": ["playwright@1.60.0", "", {}, "sha512-e"],
    `;
    expect(resolvePlaywrightVersion({ lockfileText: lock })).toBe("1.60.0");
  });
});
