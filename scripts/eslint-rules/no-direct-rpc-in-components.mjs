/**
 * Custom ESLint rule: no-direct-rpc-in-components
 *
 * Warns when `forPlugin()` is called inside React component functions.
 * Components should use `usePluginClient()` for data fetching with TanStack Query.
 *
 * Allowed in:
 * - Event handlers (onClick, onSubmit, etc.) for mutations
 * - useEffect callbacks for imperative calls
 * - Non-component functions
 */

// Patterns that indicate we're in a component
const componentPatterns = [
  // Function component: function MyComponent() or const MyComponent = () =>
  /^[A-Z][A-Za-z\d]*$/,
];

// Check if a function name looks like a React component
function isComponentName(name) {
  if (!name) return false;
  return componentPatterns.some((pattern) => pattern.test(name));
}

// Get the name of a function node
function getFunctionName(node) {
  if (node.type === "FunctionDeclaration" && node.id) {
    return node.id.name;
  }
  if (node.parent?.type === "VariableDeclarator") {
    return node.parent.id?.name;
  }
}

// No allowed contexts anymore - all frontend code should use usePluginClient
// forPlugin() is only for S2S (server-to-server) calls
function isInAllowedContext() {
  return false;
}

export const noDirectRpcInComponents = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn against using forPlugin() directly in React components. Use usePluginClient() instead for automatic caching and request deduplication.",
      recommended: true,
    },
    messages: {
      usePluginClient:
        "Avoid calling forPlugin() in components. Use usePluginClient(ApiDefinition) from @checkstack/frontend-api instead. It provides .useQuery() for data fetching and .useMutation() for modifications.",
    },
    schema: [],
  },

  create(context) {
    // Track if we're inside a React component
    const componentStack = [];

    return {
      // Track entering function declarations
      FunctionDeclaration(node) {
        const name = getFunctionName(node);
        if (isComponentName(name)) {
          componentStack.push({ node, name });
        }
      },

      // Track exiting function declarations
      "FunctionDeclaration:exit"(node) {
        const name = getFunctionName(node);
        if (
          isComponentName(name) &&
          componentStack.length > 0 &&
          componentStack.at(-1).node === node
        ) {
          componentStack.pop();
        }
      },

      // Track entering function expressions
      FunctionExpression(node) {
        const name = getFunctionName(node);
        if (isComponentName(name)) {
          componentStack.push({ node, name });
        }
      },

      // Track exiting function expressions
      "FunctionExpression:exit"(node) {
        const name = getFunctionName(node);
        if (
          isComponentName(name) &&
          componentStack.length > 0 &&
          componentStack.at(-1).node === node
        ) {
          componentStack.pop();
        }
      },

      // Track entering arrow functions
      ArrowFunctionExpression(node) {
        const name = getFunctionName(node);
        if (isComponentName(name)) {
          componentStack.push({ node, name });
        }
      },

      // Track exiting arrow functions
      "ArrowFunctionExpression:exit"(node) {
        const name = getFunctionName(node);
        if (
          isComponentName(name) &&
          componentStack.length > 0 &&
          componentStack.at(-1).node === node
        ) {
          componentStack.pop();
        }
      },

      // Check for forPlugin() calls
      CallExpression(node) {
        // Check if this is a forPlugin call
        const isForPluginCall =
          node.callee?.type === "MemberExpression" &&
          node.callee.property?.name === "forPlugin";

        // Only warn if we're inside a component and not in an allowed context
        if (
          isForPluginCall &&
          componentStack.length > 0 &&
          !isInAllowedContext(node)
        ) {
          context.report({
            node,
            messageId: "usePluginClient",
          });
        }
      },
    };
  },
};
