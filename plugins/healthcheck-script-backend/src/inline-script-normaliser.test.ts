import { describe, expect, it } from "bun:test";
import {
  normaliseUserScript,
  rewriteHelperImports,
} from "./inline-script-collector";

/**
 * The inline-script collector applies two text transforms to user source
 * before writing it to a temp `.mjs` file:
 *
 *  1. `normaliseUserScript` — wraps legacy `return X;` style scripts in an
 *     async IIFE so they're valid as a module's default export, while
 *     leaving real ESM modules (those with top-level `import`/`export`)
 *     untouched.
 *
 *  2. `rewriteHelperImports` — rewrites `from "@checkstack/healthcheck"`
 *     to point at a runtime helper file written next to the user script.
 *
 * Both are easy to regress (a regex tweak that gets greedier than
 * intended, an edge case with comments, …) and both directly affect
 * whether user scripts run at all. Keep this suite tight.
 */

describe("normaliseUserScript", () => {
  it("wraps a bare `return` body in an async IIFE default export", () => {
    const out = normaliseUserScript("return { success: true };");
    expect(out).toContain("export default await (async () => {");
    expect(out).toContain("return { success: true };");
    expect(out).toContain("})();");
  });

  it("wraps a no-return body (side-effect script) the same way", () => {
    const out = normaliseUserScript("console.log('hi');");
    expect(out).toContain("export default await (async () => {");
    expect(out).toContain("console.log('hi');");
  });

  it("leaves a real ESM module (with top-level `import`) untouched", () => {
    const src = `import { loadavg } from "node:os";\nexport default { success: true };`;
    expect(normaliseUserScript(src)).toBe(src);
  });

  it("leaves a module with only `export default` (no import) untouched", () => {
    const src = `export default { success: true };`;
    expect(normaliseUserScript(src)).toBe(src);
  });

  it("leaves a script with `export` after leading whitespace untouched", () => {
    // Top-level matters regardless of leading whitespace — the regex is
    // anchored with `^\s*` per-line via the `m` flag.
    const src = `   export default 42;`;
    expect(normaliseUserScript(src)).toBe(src);
  });

  it("treats indented `return`-style scripts as legacy (wraps them)", () => {
    // Per current behaviour: only top-of-line `export`/`import` qualifies
    // as ESM. Anything else gets wrapped. This is intentional — a script
    // that contains the substring "import" inside a comment shouldn't be
    // misclassified as ESM and have its `return` left dangling.
    const src = `  // imports are great\n  return true;`;
    expect(normaliseUserScript(src)).toContain("export default await");
  });

  it("appends a trailing newline before `})` so a trailing `//` comment doesn't swallow the brace", () => {
    const out = normaliseUserScript("return true; // trailing comment");
    // Confirm the wrapper structure didn't get clobbered by the comment.
    expect(out).toMatch(/return true; \/\/ trailing comment\s*\n\}\)\(\)/);
  });
});

describe("rewriteHelperImports", () => {
  const HELPER_URL = "file:///tmp/checkstack-script-abc/_helpers.mjs";

  it("rewrites a named import from `@checkstack/healthcheck`", () => {
    const out = rewriteHelperImports(
      `import { defineHealthCheck } from "@checkstack/healthcheck";`,
      HELPER_URL,
    );
    expect(out).toBe(
      `import { defineHealthCheck } from "${HELPER_URL}";`,
    );
  });

  it("works with single-quoted import specs too", () => {
    const out = rewriteHelperImports(
      `import { defineHealthCheck } from '@checkstack/healthcheck';`,
      HELPER_URL,
    );
    expect(out).toBe(
      `import { defineHealthCheck } from "${HELPER_URL}";`,
    );
  });

  it("rewrites a side-effect import too", () => {
    const out = rewriteHelperImports(
      `import "@checkstack/healthcheck";`,
      HELPER_URL,
    );
    expect(out).toBe(`import "${HELPER_URL}";`);
  });

  it("leaves other imports alone", () => {
    const src = `import { loadavg } from "node:os";\nimport fs from "node:fs/promises";`;
    expect(rewriteHelperImports(src, HELPER_URL)).toBe(src);
  });

  it("rewrites multiple occurrences", () => {
    const src = `
      import { defineHealthCheck } from "@checkstack/healthcheck";
      import type { HealthCheckScriptResult } from "@checkstack/healthcheck";
    `;
    const out = rewriteHelperImports(src, HELPER_URL);
    expect(out.match(/@checkstack\/healthcheck/g)).toBeNull();
    expect(
      [...out.matchAll(new RegExp(HELPER_URL, "g"))].length,
    ).toBe(2);
  });

  it("doesn't rewrite the package name if it appears in a string literal", () => {
    // Conservative regex: it only matches the spec position of an import
    // statement (`from "..."` / `import "..."`). A string containing the
    // package name elsewhere must be left alone.
    const src = `console.log("Look up @checkstack/healthcheck on npm");`;
    expect(rewriteHelperImports(src, HELPER_URL)).toBe(src);
  });
});
