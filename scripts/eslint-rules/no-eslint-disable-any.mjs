/**
 * Custom ESLint rule: no-eslint-disable-any
 *
 * Prevents circumventing the `@typescript-eslint/no-explicit-any` rule
 * via eslint-disable comments. Using `any` is strictly forbidden per project rules.
 */

export const noEslintDisableAny = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow eslint-disable comments that suppress @typescript-eslint/no-explicit-any",
      recommended: true,
    },
    messages: {
      noDisableAny:
        "Do not suppress @typescript-eslint/no-explicit-any. Using 'any' is strictly forbidden. Fix the types instead.",
    },
    schema: [],
  },

  create(context) {
    return {
      Program() {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        const comments = sourceCode.getAllComments();

        for (const comment of comments) {
          const text = comment.value.trim();

          // Match all forms of eslint-disable targeting no-explicit-any
          if (
            text.includes("@typescript-eslint/no-explicit-any") &&
            (text.startsWith("eslint-disable") ||
              text.startsWith("eslint-disable-next-line") ||
              text.startsWith("eslint-disable-line"))
          ) {
            context.report({
              loc: comment.loc,
              messageId: "noDisableAny",
            });
          }
        }
      },
    };
  },
};
