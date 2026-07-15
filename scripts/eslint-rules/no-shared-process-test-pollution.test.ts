import { describe, it } from "bun:test";
import { RuleTester } from "eslint";

import { noSharedProcessTestPollution } from "./no-shared-process-test-pollution.mjs";

// Drive ESLint's RuleTester through bun:test's describe/it so failures surface
// as normal test cases (RuleTester calls these statics internally).
RuleTester.describe = (text, fn) => describe(text, fn);
RuleTester.it = (text, fn) => it(text, fn);
RuleTester.itOnly = (text, fn) => it(text, fn);

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const SRC = "plugins/logstream-backend/src/ingest/helper.ts";
const TEST = "plugins/logstream-backend/src/ingest/helper.test.ts";
const PRELOAD = "core/backend/src/test-preload.ts";

ruleTester.run(
  "no-shared-process-test-pollution",
  noSharedProcessTestPollution,
  {
    valid: [
      // A test file may do all of these - it is isolated by the runner.
      {
        filename: TEST,
        code: `mock.module("./db", () => ({ db: {} }));`,
      },
      {
        filename: TEST,
        code: `global.fetch = mockFetch;`,
      },
      {
        filename: TEST,
        code: `spyOn(globalThis, "fetch");`,
      },
      // The sanctioned global preload may mock modules for the whole suite.
      {
        filename: PRELOAD,
        code: `mock.module("@checkstack/backend-api", () => ({}));`,
      },
      // A .tsx test file is also fine.
      {
        filename: "core/ui/src/Foo.test.tsx",
        code: `spyOn(window, "matchMedia");`,
      },
      // A non-test module exporting a plain FACTORY is fine: it patches nothing
      // until a test/preload passes it to mock.module.
      {
        filename: SRC,
        code: `export const makeDbMock = () => ({ db: { select: () => [] } });`,
      },
      // Bare `mock()` (a local mock fn) in a non-test module is not a global
      // polluter - only `mock.module` patches the shared registry.
      {
        filename: SRC,
        code: `import { mock } from "bun:test"; export const fn = mock(() => 1);`,
      },
      // Assigning to a local object (not a global) is fine.
      {
        filename: SRC,
        code: `const obj = {}; obj.fetch = something;`,
      },
      // Spying a local object (not a global) is fine.
      {
        filename: SRC,
        code: `spyOn(service, "getStatus");`,
      },
      // A namespaced `globalThis.X` READ is fine - only assignment leaks.
      {
        filename: SRC,
        code: `const g = globalThis.fetch;`,
      },
    ],
    invalid: [
      // mock.module in a non-test importable module - the hazard this exists for.
      {
        filename: SRC,
        code: `mock.module("./db", () => ({ db: {} }));`,
        errors: [{ messageId: "mockModule" }],
      },
      // global assignment in a non-test module.
      {
        filename: SRC,
        code: `global.fetch = mockFetch;`,
        errors: [{ messageId: "globalAssign" }],
      },
      {
        filename: SRC,
        code: `globalThis.Response = FakeResponse;`,
        errors: [{ messageId: "globalAssign" }],
      },
      {
        filename: SRC,
        code: `window.matchMedia = fake;`,
        errors: [{ messageId: "globalAssign" }],
      },
      // spyOn a global in a non-test module.
      {
        filename: SRC,
        code: `spyOn(globalThis, "fetch");`,
        errors: [{ messageId: "globalSpy" }],
      },
      {
        filename: SRC,
        code: `spyOn(global, "setTimeout");`,
        errors: [{ messageId: "globalSpy" }],
      },
    ],
  },
);
