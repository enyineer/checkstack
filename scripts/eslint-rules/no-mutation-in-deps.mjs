/**
 * Custom ESLint rule: no-mutation-in-deps
 *
 * Warns when useMutation result objects are used in dependency arrays.
 * useMutation() returns a new object on every render, so including it in
 * useEffect/useMemo/useCallback dependencies causes infinite re-renders.
 *
 * The actual mutation functions (mutate, mutateAsync) are stable and safe to use.
 */

// Hooks that have dependency arrays
const HOOKS_WITH_DEPS = new Set([
  "useEffect",
  "useLayoutEffect",
  "useMemo",
  "useCallback",
  "useImperativeHandle",
]);

export const noMutationInDeps = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow useMutation result objects in React hook dependency arrays. This causes infinite re-renders because the mutation object changes on every render.",
      recommended: true,
    },
    messages: {
      mutationInDeps:
        'Avoid using "{{name}}" in dependency array. useMutation() returns a new object each render, causing infinite re-renders. Use the stable mutate/mutateAsync function directly, or omit from deps with an eslint-disable comment if intentional.',
    },
    schema: [],
  },

  create(context) {
    // Track variables that are assigned useMutation results
    const mutationVariables = new Set();

    return {
      // Track VariableDeclarator to find useMutation assignments
      VariableDeclarator(node) {
        // Check if the init is a useMutation call:
        // const mutation = client.createItem.useMutation()
        // or const { mutate } = useMutation()
        const init = node.init;
        if (!init) return;

        let isMutationCall = false;

        // Direct call: useMutation()
        if (
          init.type === "CallExpression" &&
          init.callee?.type === "Identifier" &&
          init.callee.name === "useMutation"
        ) {
          isMutationCall = true;
        }

        // Method call: client.operation.useMutation()
        if (
          init.type === "CallExpression" &&
          init.callee?.type === "MemberExpression" &&
          init.callee.property?.name === "useMutation"
        ) {
          isMutationCall = true;
        }

        if (isMutationCall && node.id?.type === "Identifier") {
          mutationVariables.add(node.id.name);
        }
      },

      // Check CallExpression for hooks with dependency arrays
      CallExpression(node) {
        // Check if this is a hook with deps
        if (node.callee?.type !== "Identifier") return;
        if (!HOOKS_WITH_DEPS.has(node.callee.name)) return;

        // Find the dependency array (last argument that's an array)
        const args = node.arguments;
        if (args.length < 2) return;

        const lastArg = args.at(-1);
        if (lastArg?.type !== "ArrayExpression") return;

        // Check each element in the dependency array
        for (const element of lastArg.elements) {
          if (!element) continue;

          let identifierName;

          // Direct identifier: [mutation]
          if (element.type === "Identifier") {
            identifierName = element.name;
          }

          // Check if this identifier is a known mutation variable
          if (identifierName && mutationVariables.has(identifierName)) {
            context.report({
              node: element,
              messageId: "mutationInDeps",
              data: { name: identifierName },
            });
          }
        }
      },
    };
  },
};
