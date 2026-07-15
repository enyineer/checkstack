import { describe, it } from "bun:test";
import { RuleTester } from "eslint";

import { noInlineDetailCardChrome } from "./no-inline-detail-card-chrome.mjs";

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

ruleTester.run("no-inline-detail-card-chrome", noInlineDetailCardChrome, {
  valid: [
    // The sanctioned way: use the shared component / class.
    {
      code: `const el = <DetailCard className="overflow-hidden">x</DetailCard>;`,
    },
    {
      code: `const cls = cn(detailCardSurface, "overflow-hidden");`,
    },
    // Unrelated chrome (a plain Card, a flat tile) is fine.
    {
      code: `const el = <div className="rounded-lg border border-border bg-card">x</div>;`,
    },
    // The bg-card flat inner tile that legitimately uses a different radius.
    {
      code: `const el = <div className="rounded-md bg-surface-inset p-2">x</div>;`,
    },
  ],
  invalid: [
    // The detail-card radius token hand-rolled inline.
    {
      code: `const el = <div className="rounded-[var(--d-card-r)] border border-border/70 bg-card">x</div>;`,
      errors: [{ messageId: "inlineChrome" }],
    },
    // The surface gradient hand-rolled inline.
    {
      code: `const el = <div className="border bg-gradient-to-b from-surface-2 to-surface">x</div>;`,
      errors: [{ messageId: "inlineChrome" }],
    },
    // The elevation-shadow layer hand-rolled inline.
    {
      code: `const SHADOW = "shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]";`,
      errors: [{ messageId: "inlineChrome" }],
    },
    // A template literal that splices a PANEL_SHADOW-style constant still carries
    // the radius signature in its static part.
    {
      code: "const el = <div className={`rounded-[var(--d-card-r)] border ${PANEL_SHADOW}`}>x</div>;",
      errors: [{ messageId: "inlineChrome" }],
    },
  ],
});
