import { describe, it } from "bun:test";
import { RuleTester } from "eslint";

import { preferGatedMutation } from "./prefer-gated-mutation.mjs";

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

ruleTester.run("prefer-gated-mutation", preferGatedMutation, {
  valid: [
    // The fused variant is exactly what the rule wants — never flagged.
    {
      code: `const m = client.updateAutomation.useGatedMutation({});`,
    },
    // A gated query is unrelated.
    {
      code: `const q = client.listAutomations.useGatedQuery();`,
    },
    // A bare `useMutation` identifier (not a member call) is not the plugin
    // client shape and must not be flagged.
    {
      code: `const m = useMutation({ mutationFn });`,
    },
    // A single-level member call (`foo.useMutation`) lacks the nested
    // `client.proc.` accessor shape, so it is not a plugin-client mutation.
    {
      code: `const m = foo.useMutation({});`,
    },
    // A different method on the procedure accessor is not flagged.
    {
      code: `const q = client.listAutomations.useQuery();`,
    },
  ],

  invalid: [
    // The canonical raw plugin-client mutation: client.proc.useMutation(...).
    {
      code: `const m = client.updateAutomation.useMutation({});`,
      errors: [{ messageId: "preferGated" }],
    },
    // Deeper accessor chains still match (object is a MemberExpression).
    {
      code: `const m = api.automation.client.createAutomation.useMutation({});`,
      errors: [{ messageId: "preferGated" }],
    },
    // No arguments still flags — the call shape is what matters.
    {
      code: `const m = client.deleteAutomation.useMutation();`,
      errors: [{ messageId: "preferGated" }],
    },
  ],
});
