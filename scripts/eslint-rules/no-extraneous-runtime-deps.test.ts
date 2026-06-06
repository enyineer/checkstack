import { describe, it } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RuleTester } from "eslint";

import { noExtraneousRuntimeDeps } from "./no-extraneous-runtime-deps.mjs";

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

// The rule reads the CLOSEST real package.json on disk from the linted file's
// path, so we point at actual source files in the repo. `@checkstack/ui`
// (whose package.json declares its own name) is the self-reference case.
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const UI_SRC = path.join(REPO_ROOT, "core/ui/src/components/SelfRef.tsx");

ruleTester.run("no-extraneous-runtime-deps", noExtraneousRuntimeDeps, {
  valid: [
    // Self-reference: `@checkstack/ui` importing its own `code-editor` subpath
    // is resolved via its own `exports` map and must never be flagged as a
    // missing dependency of itself.
    {
      filename: UI_SRC,
      code: `import { CodeEditor } from "@checkstack/ui/code-editor";`,
    },
    // Bare self-name (no subpath) is equally a self-reference.
    {
      filename: UI_SRC,
      code: `import { Button } from "@checkstack/ui";`,
    },
  ],
  invalid: [
    // A genuinely-missing third-party runtime import is still flagged so the
    // self-reference guard above can't be read as "the rule went soft".
    {
      filename: UI_SRC,
      code: `import x from "totally-not-installed-pkg";`,
      errors: [{ messageId: "missingDep" }],
    },
  ],
});
