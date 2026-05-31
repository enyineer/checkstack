import js from "@eslint/js";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";
import reactHooks from "eslint-plugin-react-hooks";
import checkstackPlugin from "./scripts/eslint-rules/checkstack-plugin.mjs";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/storybook-static/**",
      "**/.tsbuild/**",
      "**/drizzle/**",
      "**/public/vendor/**",
      "**/*.test.ts*",
      "**/*.e2e.ts",
      // Astro-generated files and the docs site source. Astro provides its
      // own type checking via `astro check`; running our ESLint rules over
      // its virtual-module imports (`astro:content`) and generated `.astro/`
      // dir produces false positives.
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      unicorn,
      "react-hooks": reactHooks,
      checkstack: checkstackPlugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      ...unicorn.configs.recommended.rules,
      "unicorn/filename-case": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/prefer-module": "off",
      "unicorn/no-nested-ternary": "off",
      // `null` is a legitimate value in this codebase, especially around
      // Drizzle: an insert with `null` writes a NULL column, while
      // `undefined` is interpreted as "leave this column unset". The two
      // are NOT interchangeable, so we don't lint them away.
      "unicorn/no-null": "off",
      // React hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Ban raw `instanceof Error` — use extractErrorMessage() instead
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "BinaryExpression[operator='instanceof'][right.name='Error']",
          message:
            "Do not use 'instanceof Error' directly. Use extractErrorMessage() from @checkstack/common instead.",
        },
      ],
      // Custom checkstack rules
      "checkstack/no-direct-rpc-in-components": "error",
      "checkstack/no-mutation-in-deps": "error",
      "checkstack/enforce-architecture-deps": "error",
      "checkstack/no-extraneous-runtime-deps": "error",
      "checkstack/enforce-package-metadata": "error",
      "checkstack/no-eslint-disable-any": "error",
      // Reactive automation engine backstop (plan §6.4, §15.6). Severity is
      // intentionally `warn` and MUST NOT be escalated to `error`: it informs
      // authors that entity state should flow through `defineEntity`, it does
      // not block CI (see .agent/rules/code-style-guide.md). The entity hooks
      // it flags are removed in the migration phase (plan §9).
      "checkstack/no-unmanaged-entity-state": [
        "warn",
        {
          // §9 "keep" hooks that happen to match the naming shape but are NOT
          // entity-change events (lifecycle / config-change signals). They are
          // exempted so the rule's signal stays on genuine entity hooks.
          allowedHookIds: [
            // The framework's own internal entity-change hook — this IS the
            // canonical defineEntity emit path (plan §6.1), not an off-pattern
            // manual hook, so it must never be flagged.
            "automation.entity.changed",
            // §9 "keep" hooks: lifecycle / config-change signals that match the
            // naming shape but are not entity-change events.
            "auth.user.deleted",
            "healthcheck.assignment.changed",
          ],
          // Migrated-domain former state columns to flag direct writes to.
          // EMPTY at this phase — no domain is migrated yet (plan §16 step 4
          // populates this as each domain moves to defineEntity), so part (b)
          // matches nothing on the current codebase.
          deniedColumns: [],
          // Tables declared non-reactive via declareNonReactiveState (plan §5).
          // Mirror each runtime declaration here so part (b)'s matches on that
          // table are suppressed. EMPTY until a denylisted column exists.
          allowedTables: [],
        },
      ],
      // Horizontal-scale safety tripwire (.agent/rules/state-and-scale.md). A
      // reactive entity's `read` must resolve from shared/durable storage so a
      // write on pod A is visible on pod B. Severity is intentionally `warn`
      // and MUST NOT be escalated to `error`: it is a single-file forcing
      // function at the `defineEntity` boundary, not a sound cross-module
      // analysis (the deterministic check is the cross-pod IT test). See
      // .agent/rules/code-style-guide.md ("do NOT escalate warnings to errors").
      "checkstack/no-pod-local-entity-state": [
        "warn",
        {
          // Entity kinds exempt from the durable-read check (none today).
          allowedKinds: [],
          // Durable-accessor function names that resolve to shared storage but
          // don't match the built-in name shapes (createXEntityRead / getMany*
          // / *EntityStates). Empty: every real site matches a built-in shape.
          durableAccessors: [],
        },
      ],
    },
  },
  // Frontend packages: ban console.* to enforce proper error handling
  {
    files: [
      "core/*-frontend/src/**/*.{ts,tsx}",
      "plugins/*-frontend/src/**/*.{ts,tsx}",
    ],
    ignores: [
      "**/logger-api.ts",
      "**/plugin-loader.ts",
      "**/plugin-registry.ts",
      "**/SignalProvider.tsx",
      "**/runtime-config.tsx",
    ],
    rules: {
      "no-console": "error",
    },
  },
  // Standalone scripts: exempt from instanceof Error ban (can't import workspace packages)
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  // Standalone satellite agent: not a platform plugin, exempt from metadata requirement
  {
    files: ["core/satellite/src/**/*.ts"],
    rules: {
      "checkstack/enforce-package-metadata": "off",
    },
  }
);
