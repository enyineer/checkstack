import js from "@eslint/js";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";
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
      // Custom checkstack rules
      "checkstack/no-direct-rpc-in-components": "error",
      "checkstack/no-mutation-in-deps": "error",
      "checkstack/enforce-architecture-deps": "error",
    },
  }
);
