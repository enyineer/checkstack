import { describe, it } from "bun:test";
import { RuleTester } from "eslint";

import { noUnguardedAnimation } from "./no-unguarded-animation.mjs";

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

// A path inside frontend source (the rule's structural scope).
const FRONTEND = "/repo/core/ui/src/components/Widget.tsx";
// A path OUTSIDE any frontend src tree (rule must be a no-op here).
const BACKEND = "/repo/core/incident-backend/src/service.ts";

ruleTester.run("no-unguarded-animation", noUnguardedAnimation, {
  valid: [
    // No animation class at all.
    {
      filename: FRONTEND,
      code: `const x = <div className="flex gap-2" />;`,
    },
    // Animation class OUTSIDE frontend src is not flagged (structural scope).
    {
      filename: BACKEND,
      code: `const x = "animate-spin fade-in";`,
    },
    // Precise guard: right operand of a `!isLowPower && "..."` logical expr.
    {
      filename: FRONTEND,
      code: `const x = <div className={cn("base", !isLowPower && "animate-spin")} />;`,
    },
    // Precise guard: conditional branch gated by isLowPower.
    {
      filename: FRONTEND,
      code: `const x = <div className={isLowPower ? "" : "animate-pulse"} />;`,
    },
    // Coarse fallback: module references isLowPower somewhere, so a bare
    // template-literal className is assumed handled and stays silent.
    {
      filename: FRONTEND,
      code: `
        const { isLowPower } = usePerformance();
        const cls = isLowPower ? "" : "x";
        const x = <div className={\`animate-in fade-in-0 \${cls}\`} />;
      `,
    },
    // allowedClasses escape hatch suppresses an otherwise-flagged token.
    {
      filename: FRONTEND,
      code: `const x = <div className="fade-in-0" />;`,
      options: [{ allowedClasses: ["fade-in-0"] }],
    },
    // Custom guard identifier via additionalGuardIdentifiers (precise form).
    {
      filename: FRONTEND,
      code: `const x = <div className={cn(!reduceMotion && "animate-spin")} />;`,
      options: [{ additionalGuardIdentifiers: ["reduceMotion"] }],
    },
    // Non-animation backdrop is fine; only blur is flagged.
    {
      filename: FRONTEND,
      code: `const x = <div className="bg-card border" />;`,
    },
    // Coarse fallback: once the module references isLowPower anywhere (here in a
    // precise guard), an adjacent bare animation literal is assumed handled and
    // stays silent. This deliberately trades recall for precision.
    {
      filename: FRONTEND,
      code: `const x = <div className={cn(!isLowPower && "animate-spin", "animate-pulse")} />;`,
    },
  ],

  invalid: [
    // Bare string-literal className with an animation token, no guard anywhere.
    {
      filename: FRONTEND,
      code: `const x = <div className="animate-spin" />;`,
      errors: [{ messageId: "unguardedAnimation", data: { token: "animate-spin" } }],
    },
    // Template-literal quasi (the documented Tabs.tsx shape) with no guard.
    {
      filename: FRONTEND,
      code: `const x = <div className={\`animate-in fade-in-0 duration-200\`} />;`,
      errors: [{ messageId: "unguardedAnimation" }],
    },
    // backdrop-blur is flagged like animations.
    {
      filename: FRONTEND,
      code: `const x = <div className="backdrop-blur-sm bg-card/80" />;`,
      errors: [{ messageId: "unguardedAnimation", data: { token: "backdrop-blur-sm" } }],
    },
    // Unguarded literal inside cn(): the module never references isLowPower.
    {
      filename: FRONTEND,
      code: `const x = <div className={cn("base", "animate-pulse")} />;`,
      errors: [{ messageId: "unguardedAnimation", data: { token: "animate-pulse" } }],
    },
    // slide-in-/zoom-in token families.
    {
      filename: FRONTEND,
      code: `const x = <div className="slide-in-from-top zoom-in-95" />;`,
      errors: [{ messageId: "unguardedAnimation" }],
    },
  ],
});
