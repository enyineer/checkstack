/**
 * Custom ESLint rule: no-shared-process-test-pollution
 *
 * The test runner (`scripts/run-tests.ts`) runs the bulk of the suite in ONE
 * shared process for speed, and pulls only the files that leak process-global
 * state into a separate `--isolate` pass. It detects that leaking set by
 * grepping each **test file** for the dangerous patterns:
 *   - `mock.module(...)`  (patches the shared module registry)
 *   - `globalThis`/`global`/`window` property assignment (e.g. replacing global
 *     `fetch`)
 *   - `spyOn(globalThis|global|window, ...)` (spying a global object leaks)
 *
 * That detection is per-file, so it only works if every such call is VISIBLE in
 * the test file itself. If a call is hidden inside an importable NON-test module
 * (a shared "test helper" that a test merely imports and invokes), the runner
 * cannot see it, the test file lands in the fast shared pass, and the mock/
 * global mutation leaks into unrelated suites - a distant, order-dependent
 * flake. (Exporting a plain FACTORY that returns mock data is fine: the factory
 * doesn't patch anything until a test/preload passes it to `mock.module`. Only
 * ACTUALLY CALLING these APIs at import time is the hazard.)
 *
 * This rule forbids those calls outside `*.test.*` files, so every polluter
 * stays where the runner's grep can find it and isolate it. The one sanctioned
 * exception is the global test preload (`core/backend/src/test-preload.ts`),
 * which mocks db/logger/core-services once for the whole suite by design.
 *
 * Severity is `error`: the codebase already conforms (only the preload calls
 * `mock.module` outside tests), and a new violation is a real correctness risk
 * (it silently defeats the runner's isolation partition), not a style nit.
 */

/** Files allowed to call the polluting APIs despite not being test files. */
const ALLOWED_NON_TEST = [
  // The one sanctioned global preload (bunfig `[test] preload`).
  "core/backend/src/test-preload.ts",
];

const GLOBAL_OBJECTS = new Set(["globalThis", "global", "window"]);

function isTestFile(filename) {
  return /\.test\.[cm]?[jt]sx?$/.test(filename);
}

function isAllowed(filename) {
  return ALLOWED_NON_TEST.some((suffix) =>
    filename.replaceAll("\\", "/").endsWith(suffix),
  );
}

export const noSharedProcessTestPollution = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow mock.module / global-object mutation / global spyOn outside test files. Hiding them in an importable helper defeats the test runner's per-file isolation detection and leaks state into unrelated suites.",
      recommended: true,
    },
    messages: {
      mockModule:
        "`mock.module()` outside a *.test.* file is not allowed: it patches the shared module registry on import and is invisible to the test runner's per-file isolation grep (scripts/run-tests.ts), so it can leak a mock into unrelated suites. Call it inside the test file that needs it, or export a plain factory the test passes to `mock.module`.",
      globalAssign:
        "Assigning to `{{obj}}.{{prop}}` outside a *.test.* file leaks a global mutation across the shared test process and is invisible to the runner's isolation grep. Do this inside the test file (with an afterEach restore) instead.",
      globalSpy:
        "`spyOn({{obj}}, ...)` outside a *.test.* file leaks a global spy across the shared test process and is invisible to the runner's isolation grep. Spy inside the test file that needs it (with mockRestore/afterEach) instead.",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    // Only guard non-test source files; test files legitimately do this and are
    // isolated by the runner. The preload is the one sanctioned exception.
    if (isTestFile(filename) || isAllowed(filename)) return {};

    return {
      // mock.module(...)
      "CallExpression[callee.type='MemberExpression']"(node) {
        const callee = node.callee;
        if (
          callee.object?.type === "Identifier" &&
          callee.object.name === "mock" &&
          callee.property?.type === "Identifier" &&
          callee.property.name === "module"
        ) {
          context.report({ node, messageId: "mockModule" });
        }
      },
      // spyOn(globalThis|global|window, ...)
      "CallExpression[callee.type='Identifier'][callee.name='spyOn']"(node) {
        const first = node.arguments[0];
        if (first?.type === "Identifier" && GLOBAL_OBJECTS.has(first.name)) {
          context.report({
            node,
            messageId: "globalSpy",
            data: { obj: first.name },
          });
        }
      },
      // globalThis|global|window.X = ...
      "AssignmentExpression[left.type='MemberExpression']"(node) {
        const left = node.left;
        if (
          left.object?.type === "Identifier" &&
          GLOBAL_OBJECTS.has(left.object.name) &&
          left.property?.type === "Identifier"
        ) {
          context.report({
            node,
            messageId: "globalAssign",
            data: { obj: left.object.name, prop: left.property.name },
          });
        }
      },
    };
  },
};
