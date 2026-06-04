/**
 * Custom ESLint rule: no-unguarded-animation
 *
 * Forcing function for `.agent/rules/performance.md`: expensive visual effects
 * (CSS animations, backdrop blurs, entry/exit transitions) MUST degrade on
 * low-power devices by being gated behind `usePerformance().isLowPower`. Nothing
 * else enforces this today, so new unguarded effects slip in silently.
 *
 * Severity is intentionally `warn` in `eslint.config.mjs` and MUST NEVER be
 * escalated to `error` (and never via `--max-warnings 0`): a sound static proof
 * of a runtime guard is impossible, so this is an informational tripwire that
 * biases toward FEW false positives, not a CI gate. See
 * `.agent/rules/code-style-guide.md` ("do NOT escalate warnings to errors").
 *
 * It fires only inside frontend source (`core/*-frontend/src`,
 * `plugins/*-frontend/src`, `core/ui/src`). Storybook stories and test files are
 * excluded via `eslint.config.mjs` `ignores` (stories intentionally showcase
 * effects unguarded).
 *
 * ## What it inspects
 *
 *   - JSX `className` / `class` attribute values: string literals and the
 *     static quasis of template literals.
 *   - The string-literal arguments (and their template quasis) passed to the
 *     class-composition helpers `cn(...)`, `clsx(...)`, and `cva(...)`.
 *
 * Each collected literal is tested against an animation/blur token regex
 * (`animate-`, `backdrop-blur`, `fade-in`, `fade-out`, `zoom-in`, `zoom-out`,
 * `slide-in-`, `slide-out-`).
 *
 * ## Suppression heuristic (precision over recall)
 *
 *   1. Precise signal — a matched literal that is the right operand of a logical
 *      expression (`!isLowPower && "animate-spin"`) or a branch of a conditional
 *      (`isLowPower ? "" : "animate-spin"`) whose test references `isLowPower`
 *      (or any `additionalGuardIdentifiers`) is treated as guarded and NOT
 *      reported.
 *   2. Coarse fallback — for className shapes not expressible as #1 (composed
 *      across multiple statements, JS-level guards, etc.) the rule only reports
 *      when the ENCLOSING MODULE never references `isLowPower` (or a configured
 *      guard identifier) at all. If the guard appears anywhere in the file the
 *      author is assumed to have handled it and the rule stays silent. This
 *      deliberately trades recall for precision.
 *
 * ## Options
 *
 *   {
 *     // Animation/blur tokens that are cheap/always-on and never need a guard
 *     // (e.g. a single-frame `fade-in-0`). Matched per whitespace-separated
 *     // class token; an exact match suppresses that token.
 *     allowedClasses: string[],
 *     // Extra guard identifier names beyond `isLowPower` (non-standard guard
 *     // names) that satisfy both the precise and coarse checks.
 *     additionalGuardIdentifiers: string[],
 *   }
 *
 * ## Known gap (out of scope, intentional)
 *
 * This rule cannot see raw CSS `@keyframes` / `animation:` declarations in
 * `.css` files (e.g. `core/ui/src/themes.css`) — ESLint does not parse CSS, and
 * the runtime guard there is class-swapping, not a static expression. Covering
 * that needs a separate stylelint pass or a class-name allowlist convention.
 */

const DEFAULT_GUARD = "isLowPower";

// Animation / blur token matcher. Matches the documented Tailwind utility
// families (and the `tailwindcss-animate` entry/exit utilities).
const ANIMATION_TOKEN_REGEX =
  /\b(?:animate-[\w-]+|backdrop-blur(?:-[\w-]+)?|fade-in(?:-[\w-]+)?|fade-out(?:-[\w-]+)?|zoom-in(?:-[\w-]+)?|zoom-out(?:-[\w-]+)?|slide-in-[\w-]+|slide-out-[\w-]+)/;

/** Only fire inside frontend source trees. */
const FRONTEND_REGEX =
  /(?:^|[\\/])(?:(?:core|plugins)[\\/][^\\/]*-frontend|core[\\/]ui)[\\/]src[\\/]/;

// Class-composition helpers whose string arguments carry className tokens.
const CLASS_HELPERS = new Set(["cn", "clsx", "cva"]);

/**
 * Find the first animation/blur class token in a class string, skipping tokens
 * that are explicitly allow-listed. Returns the matched token or undefined.
 * @param {string} value
 * @param {Set<string>} allowedClasses
 * @returns {string | undefined}
 */
function findAnimationToken(value, allowedClasses) {
  for (const token of value.split(/\s+/)) {
    if (token.length === 0) continue;
    if (allowedClasses.has(token)) continue;
    if (ANIMATION_TOKEN_REGEX.test(token)) return token;
  }
  return;
}

/**
 * Does an AST node reference any of the guard identifiers? Walks plain
 * identifier / unary / member shapes used in guard expressions.
 * @param {object | null | undefined} node
 * @param {Set<string>} guards
 * @returns {boolean}
 */
function referencesGuard(node, guards) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "Identifier") return guards.has(node.name);
  if (node.type === "UnaryExpression") {
    return referencesGuard(node.argument, guards);
  }
  if (node.type === "LogicalExpression" || node.type === "BinaryExpression") {
    return (
      referencesGuard(node.left, guards) || referencesGuard(node.right, guards)
    );
  }
  if (node.type === "MemberExpression") {
    return (
      referencesGuard(node.object, guards) ||
      (node.computed ? referencesGuard(node.property, guards) : false)
    );
  }
  if (node.type === "CallExpression") {
    return (
      referencesGuard(node.callee, guards) ||
      node.arguments.some((argument) => referencesGuard(argument, guards))
    );
  }
  return false;
}

/**
 * Is this literal node guarded by a precise, low-false-positive expression?
 * True when the literal is (transitively through grouping) the operand of a
 * logical expression or a branch of a conditional whose controlling expression
 * references a guard identifier — e.g. `!isLowPower && "animate-spin"` or
 * `isLowPower ? "" : "animate-spin"`.
 * @param {object} literalNode
 * @param {Set<string>} guards
 * @returns {boolean}
 */
function isPreciselyGuarded(literalNode, guards) {
  let current = literalNode;
  let parent = current.parent;
  while (parent) {
    if (parent.type === "LogicalExpression") {
      // `<guard-expr> && "animate-..."` / `... || "animate-..."`: the test is
      // the left operand and references a guard.
      if (referencesGuard(parent.left, guards)) return true;
    } else if (parent.type === "ConditionalExpression") {
      // `<guard-expr> ? a : b`: either branch is guarded by the test.
      if (
        (parent.consequent === current || parent.alternate === current) &&
        referencesGuard(parent.test, guards)
      ) {
        return true;
      }
    } else if (
      // Keep climbing through transparent grouping/positions; stop at
      // boundaries where a guard could no longer apply to this literal.
      parent.type !== "TemplateLiteral" &&
      parent.type !== "JSXExpressionContainer" &&
      parent.type !== "JSXAttribute"
    ) {
      // For any other parent (call args, array elements, object props, JSX
      // attribute value, etc.) the precise signal does not apply — fall back.
      return false;
    }
    current = parent;
    parent = current.parent;
  }
  return false;
}

export const noUnguardedAnimation = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn on Tailwind animation/blur classes that are not gated behind usePerformance().isLowPower (performance degradation, .agent/rules/performance.md).",
      recommended: false,
    },
    messages: {
      unguardedAnimation:
        "'{{token}}' is not guarded by 'isLowPower'. Gate animation/blur classes behind usePerformance().isLowPower (see .agent/rules/performance.md), e.g. `!isLowPower && \"{{token}}\"`. If this effect is cheap/always-on, add it to this rule's 'allowedClasses' option.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowedClasses: {
            type: "array",
            items: { type: "string" },
          },
          additionalGuardIdentifiers: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const filePath = context.filename || context.getFilename();
    if (!FRONTEND_REGEX.test(filePath)) {
      return {};
    }

    const options = context.options[0] ?? {};
    const allowedClasses = new Set(options.allowedClasses);
    const guards = new Set([DEFAULT_GUARD, ...(options.additionalGuardIdentifiers ?? [])]);

    // Whether the enclosing module references a guard identifier ANYWHERE. Used
    // by the coarse fallback: if it does, assume the author handled degradation.
    let moduleReferencesGuard = false;

    // Pending reports, resolved at Program:exit once we know whether the module
    // references a guard. A precise-guard match is dropped immediately; an
    // unguarded literal is queued and only emitted if the module never mentions
    // a guard.
    const pending = [];

    /**
     * Inspect one literal class string for an animation token and decide.
     * @param {object} literalNode  the AST node carrying `value` (Literal or
     *   TemplateElement); reported as the violation site.
     * @param {string} value  the raw class string.
     * @param {object} guardScopeNode  the node used for the precise-guard climb
     *   (for template quasis this is the enclosing TemplateLiteral so the climb
     *   sees the logical/conditional parent).
     */
    function inspect(literalNode, value, guardScopeNode) {
      const token = findAnimationToken(value, allowedClasses);
      if (token === undefined) return;
      if (isPreciselyGuarded(guardScopeNode, guards)) return;
      pending.push({ node: literalNode, token });
    }

    /**
     * Collect class strings from a className/class value node or a class-helper
     * argument node.
     * @param {object} node
     */
    function collectFromValueNode(node) {
      if (!node) return;
      if (node.type === "Literal" && typeof node.value === "string") {
        inspect(node, node.value, node);
        return;
      }
      if (node.type === "TemplateLiteral") {
        for (const quasi of node.quasis) {
          const raw = quasi.value.cooked ?? quasi.value.raw;
          if (typeof raw === "string") inspect(quasi, raw, quasi);
        }
        return;
      }
      if (node.type === "JSXExpressionContainer") {
        collectFromValueNode(node.expression);
        return;
      }
      // Logical / conditional class expressions: recurse so a precise guard on
      // an inner literal is still detected.
      if (node.type === "LogicalExpression") {
        collectFromValueNode(node.left);
        collectFromValueNode(node.right);
        return;
      }
      if (node.type === "ConditionalExpression") {
        collectFromValueNode(node.consequent);
        collectFromValueNode(node.alternate);
        return;
      }
      // CallExpression (e.g. a `cn(...)` inside className) is intentionally NOT
      // recursed here — the dedicated `CallExpression` visitor handles every
      // cn()/clsx()/cva() call site directly, so recursing would double-report.
    }

    return {
      Identifier(node) {
        if (guards.has(node.name)) moduleReferencesGuard = true;
      },

      JSXAttribute(node) {
        const name =
          node.name?.type === "JSXIdentifier" ? node.name.name : undefined;
        if (name !== "className" && name !== "class") return;
        collectFromValueNode(node.value);
      },

      CallExpression(node) {
        const callee = node.callee;
        const calleeName =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression" &&
                !callee.computed &&
                callee.property.type === "Identifier"
              ? callee.property.name
              : undefined;
        if (calleeName === undefined || !CLASS_HELPERS.has(calleeName)) return;
        for (const argument of node.arguments) collectFromValueNode(argument);
      },

      "Program:exit"() {
        if (moduleReferencesGuard) return;
        for (const { node, token } of pending) {
          context.report({
            node,
            messageId: "unguardedAnimation",
            data: { token },
          });
        }
      },
    };
  },
};
