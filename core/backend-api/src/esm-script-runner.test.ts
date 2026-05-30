import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  defaultEsmScriptRunner,
  normaliseUserScript,
  rewriteHelperImports,
} from "./esm-script-runner";

/**
 * The shared ESM-script runner applies two text transforms to user
 * source before writing it to a temp `.mjs` file:
 *
 *  1. `normaliseUserScript` — wraps legacy `return X;` style scripts in
 *     an async IIFE so they're valid as a module's default export,
 *     while leaving real ESM modules (those with top-level
 *     `import`/`export`) untouched.
 *
 *  2. `rewriteHelperImports` — rewrites `from "<helperModuleName>"`
 *     to point at a runtime helper file written next to the user
 *     script.
 *
 * Both are easy to regress (a regex tweak that gets greedier than
 * intended, an edge case with comments, …) and both directly affect
 * whether user scripts run at all. Keep this suite tight.
 *
 * These were previously tested under
 * `plugins/healthcheck-script-backend/src/inline-script-normaliser.test.ts`;
 * the utilities now live in `@checkstack/backend-api` and are shared by
 * both healthcheck (inline-script-collector) and integration
 * (script-provider).
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

  it("rewrites a named import from the helper module", () => {
    const out = rewriteHelperImports({
      userScript: `import { defineHealthCheck } from "@checkstack/healthcheck";`,
      helperModuleName: "@checkstack/healthcheck",
      helperUrl: HELPER_URL,
    });
    expect(out).toBe(`import { defineHealthCheck } from "${HELPER_URL}";`);
  });

  it("works with single-quoted import specs too", () => {
    const out = rewriteHelperImports({
      userScript: `import { defineHealthCheck } from '@checkstack/healthcheck';`,
      helperModuleName: "@checkstack/healthcheck",
      helperUrl: HELPER_URL,
    });
    expect(out).toBe(`import { defineHealthCheck } from "${HELPER_URL}";`);
  });

  it("rewrites a side-effect import too", () => {
    const out = rewriteHelperImports({
      userScript: `import "@checkstack/healthcheck";`,
      helperModuleName: "@checkstack/healthcheck",
      helperUrl: HELPER_URL,
    });
    expect(out).toBe(`import "${HELPER_URL}";`);
  });

  it("leaves other imports alone", () => {
    const src = `import { loadavg } from "node:os";\nimport fs from "node:fs/promises";`;
    expect(
      rewriteHelperImports({
        userScript: src,
        helperModuleName: "@checkstack/healthcheck",
        helperUrl: HELPER_URL,
      }),
    ).toBe(src);
  });

  it("rewrites multiple occurrences", () => {
    const src = `
      import { defineHealthCheck } from "@checkstack/healthcheck";
      import type { HealthCheckScriptResult } from "@checkstack/healthcheck";
    `;
    const out = rewriteHelperImports({
      userScript: src,
      helperModuleName: "@checkstack/healthcheck",
      helperUrl: HELPER_URL,
    });
    expect(out.match(/@checkstack\/healthcheck/g)).toBeNull();
    expect([...out.matchAll(new RegExp(HELPER_URL, "g"))].length).toBe(2);
  });

  it("doesn't rewrite the package name if it appears in a string literal", () => {
    // Conservative regex: it only matches the spec position of an import
    // statement (`from "..."` / `import "..."`). A string containing the
    // package name elsewhere must be left alone.
    const src = `console.log("Look up @checkstack/healthcheck on npm");`;
    expect(
      rewriteHelperImports({
        userScript: src,
        helperModuleName: "@checkstack/healthcheck",
        helperUrl: HELPER_URL,
      }),
    ).toBe(src);
  });

  it("rewrites the integration helper module too (regex is parameterised)", () => {
    // The shared runner is used by both healthcheck and integration
    // plugins; the regex is built from the supplied `helperModuleName`.
    // Sanity check that the integration variant works.
    const out = rewriteHelperImports({
      userScript: `import { defineIntegration } from "@checkstack/integration";`,
      helperModuleName: "@checkstack/integration",
      helperUrl: HELPER_URL,
    });
    expect(out).toBe(`import { defineIntegration } from "${HELPER_URL}";`);
  });

  it("escapes regex metacharacters in the helper module name", () => {
    // Defence-in-depth: if someone ever passes a name with special
    // chars, we don't want it interpreted as a regex.
    const out = rewriteHelperImports({
      userScript: `import x from "weird.pkg+name";`,
      helperModuleName: "weird.pkg+name",
      helperUrl: HELPER_URL,
    });
    expect(out).toBe(`import x from "${HELPER_URL}";`);
  });
});

describe("defaultEsmScriptRunner resolutionRoot", () => {
  let root: string;

  beforeAll(async () => {
    // A throwaway "store" with a node_modules holding one fake package.
    root = await mkdtemp(path.join(tmpdir(), "cs-resroot-"));
    const pkgDir = path.join(root, "node_modules", "fake-pkg");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "fake-pkg", version: "1.0.0", main: "index.mjs" }),
    );
    await writeFile(
      path.join(pkgDir, "index.mjs"),
      "export const greeting = 'hello-from-pkg';\n",
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lets a script import a package from <resolutionRoot>/node_modules", async () => {
    const res = await defaultEsmScriptRunner.run({
      script: `import { greeting } from "fake-pkg";\nexport default greeting;`,
      context: {},
      timeoutMs: 15_000,
      resolutionRoot: root,
    });
    expect(res.error).toBeUndefined();
    expect(res.result).toBe("hello-from-pkg");
  });

  it("cannot resolve the package without a resolutionRoot (backward-compatible isolation)", async () => {
    const res = await defaultEsmScriptRunner.run({
      script: `import { greeting } from "fake-pkg";\nexport default greeting;`,
      context: {},
      timeoutMs: 15_000,
    });
    // No resolutionRoot -> runs under os.tmpdir(), no node_modules -> the
    // import fails. Either an error is surfaced or no result is produced.
    expect(res.result).toBeUndefined();
    expect(res.error).toBeDefined();
  });

  it("does NOT auto-install a missing package from the registry (degradation)", async () => {
    // A real, installable package name that is NOT in any resolutionRoot.
    // With auto-install disabled in the per-run bunfig, Bun must error
    // instead of silently fetching it from the registry.
    const res = await defaultEsmScriptRunner.run({
      script: `import isodd from "is-odd";\nexport default typeof isodd;`,
      context: {},
      timeoutMs: 20_000,
    });
    expect(res.result).toBeUndefined();
    expect(res.error).toBeDefined();
  });
});

describe("defaultEsmScriptRunner injected env", () => {
  it("exposes injected env vars as process.env in the subprocess", async () => {
    const res = await defaultEsmScriptRunner.run({
      script: `export default process.env.API_TOKEN ?? null;`,
      context: {},
      timeoutMs: 15_000,
      env: { API_TOKEN: "injected-secret-value" },
    });
    expect(res.error).toBeUndefined();
    expect(res.result).toBe("injected-secret-value");
  });

  it("does NOT expose backend env that was not injected (isolation intact)", async () => {
    // A backend secret present in the parent process must NOT leak through
    // unless it was explicitly injected for this run.
    process.env.__CS_TEST_BACKEND_SECRET = "must-not-leak";
    try {
      const res = await defaultEsmScriptRunner.run({
        script: `export default process.env.__CS_TEST_BACKEND_SECRET ?? null;`,
        context: {},
        timeoutMs: 15_000,
      });
      expect(res.result).toBeNull();
    } finally {
      delete process.env.__CS_TEST_BACKEND_SECRET;
    }
  });
});
