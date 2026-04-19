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
      "**/drizzle/**",
      "**/public/vendor/**",
      "**/*.test.ts*",
      "**/*.e2e.ts",
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
