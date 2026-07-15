/**
 * Custom ESLint rule: no-state-seed-in-effect
 *
 * Warns when a `useEffect`/`useLayoutEffect` seeds local component state from
 * one of its own dependencies - the "reset the form from props/query on every
 * change" antipattern:
 *
 *   useEffect(() => {
 *     if (open) {
 *       setName(initialData?.name ?? "");
 *       setFields(metadataToRows(initialData?.metadata));
 *     }
 *   }, [open, initialData]);   // <-- re-fires on EVERY new initialData ref
 *
 *   useEffect(() => { if (data) setDraft(data); }, [data]); // <-- on refetch
 *
 * The dependency (`initialData`, `data`, ...) usually originates from a react-
 * query result or a prop the parent rebuilds each render, so the effect re-runs
 * on every background refetch / re-render and wipes the user's in-progress
 * edits. A realtime signal invalidating the query is enough to reset the form
 * mid-edit.
 *
 * The rule flags ONLY the narrow shape where the effect body does nothing but
 * call state setters (optionally under a single `if`/early-return guard) AND at
 * least one setter reads a value that is also in the dependency array. That
 * keeps it precise: a `useEffect(() => { if (!open) setQuery("") }, [open])`
 * that resets to constants (no setter reads a dep) is NOT flagged, and effects
 * with real side effects (subscriptions, fetches) are NOT flagged.
 *
 * The fix is to seed ONCE instead of on every dependency change. Pick the
 * variant that matches the component (all live in `@checkstack/ui`):
 *  - `useSeedFormOnOpen(open, () => { ...setters... })` - a DIALOG that seeds
 *    its form fields from a prop object when it opens. Fires once per
 *    closed->open transition; ignores prop-reference churn while open.
 *  - `useInitOnceForKey(value, value?.id, (v) => ...)` - a PAGE/TAB that seeds
 *    editable state from a keyed react-query result. Seeds once per key,
 *    ignores same-key background refetches, re-seeds when the key changes. Also
 *    set `gcTime: 0` on that loader query (project convention) so a warm cache
 *    cannot race the one-shot seed. For a singleton with no id, use a stable
 *    constant key when data is present (`data ? "<x>-loaded" : null`).
 *  - a render-phase `if (open && data && !seeded)` guard - an async-loaded
 *    singleton inside an always-mounted dialog, where the seed source arrives
 *    after the open edge.
 *
 * WHEN TO DISABLE FOR A LINE: the rule matches a purely syntactic shape, so a
 * genuine ONE-WAY mirror of a value the user never edits is a false positive -
 * e.g. reflecting a global theme into a local toggle, defaulting a selection
 * when options first load, or deliberately mirroring server data continuously
 * (multi-writer consistency). For those, disable it for THAT line WITH a reason:
 *   // eslint-disable-next-line checkstack/no-state-seed-in-effect -- <why this is a non-editable one-way sync>
 * Do NOT disable it to silence a real editable-form seed; convert that instead.
 *
 * Severity is intentionally `warn` and MUST NOT be escalated to `error` (nor
 * forced green via `--max-warnings 0`): the rule cannot see whether the parent
 * happens to pass a referentially-stable prop today (which would make a given
 * site safe-but-fragile), so it informs authors rather than blocking CI. See
 * .claude/rules/code-style-guide.md ("do NOT escalate warnings to errors").
 */

const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect"]);

/** A `setFoo(...)` call, matching React's state-setter naming convention. */
function isSetterCall(node) {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "Identifier" &&
    /^set[A-Z0-9]/.test(node.callee.name)
  );
}

/**
 * Walk a list of statements and return the flat list of state-setter call
 * expressions if the body consists *solely* of setters (optionally wrapped in
 * `if`/early-return guards). Returns `null` if any other statement is present,
 * so effects that do real work are never flagged.
 */
function collectSetters(statements) {
  const setters = [];
  for (const st of statements) {
    if (st.type === "ExpressionStatement") {
      if (!isSetterCall(st.expression)) return null;
      setters.push(st.expression);
      continue;
    }
    // Bare `return;` early-out (e.g. the `if (!open) return;` guard body).
    if (st.type === "ReturnStatement" && !st.argument) continue;
    if (st.type === "IfStatement") {
      // An `else` branch means branching logic, not a simple guarded seed.
      if (st.alternate) return null;
      const consequent = st.consequent;
      if (consequent.type === "ReturnStatement" && !consequent.argument) {
        // `if (cond) return;` guard - fine, contributes no setters.
        continue;
      }
      const inner =
        consequent.type === "BlockStatement"
          ? collectSetters(consequent.body)
          : collectSetters([consequent]);
      if (inner === null) return null;
      setters.push(...inner);
      continue;
    }
    // Anything else (variable decls, awaits, other calls) -> not a pure seed.
    return null;
  }
  return setters;
}

/** Collect every identifier name referenced anywhere within `node`. */
function collectReferencedIdentifiers(node, out) {
  if (!node || typeof node.type !== "string") return;
  if (node.type === "Identifier") {
    out.add(node.name);
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) collectReferencedIdentifiers(child, out);
    } else if (value && typeof value.type === "string") {
      collectReferencedIdentifiers(value, out);
    }
  }
}

/** True for `useEffect(...)` and `React.useEffect(...)` call expressions. */
function effectHookName(callee) {
  if (callee?.type === "Identifier" && EFFECT_HOOKS.has(callee.name)) {
    return callee.name;
  }
  if (
    callee?.type === "MemberExpression" &&
    callee.property?.type === "Identifier" &&
    EFFECT_HOOKS.has(callee.property.name)
  ) {
    return callee.property.name;
  }
  return null;
}

export const noStateSeedInEffect = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow seeding local state from a dependency inside useEffect. The effect re-runs on every dependency change (including background query refetches), resetting the form while the user is editing. Seed once with useSeedFormOnOpen / useInitOnceForKey instead.",
      recommended: true,
    },
    messages: {
      seedInEffect:
        'This effect re-seeds local state from "{{dep}}" on every change of that dependency - including background query refetches - which resets the form while the user is editing. Seed once instead: useSeedFormOnOpen(open, () => ...) for prop-seeded dialogs, useInitOnceForKey(value, value?.id, ...) for keyed query results, or a render-phase open-guard. See core/ui/src/hooks/useSeedFormOnOpen.ts.',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (!effectHookName(node.callee)) return;

        const args = node.arguments;
        if (args.length < 2) return; // no deps array -> different concern

        const [effectFn, depsArg] = args;
        if (
          effectFn?.type !== "ArrowFunctionExpression" &&
          effectFn?.type !== "FunctionExpression"
        ) {
          return;
        }
        if (depsArg?.type !== "ArrayExpression") return;
        // Empty deps -> runs once on mount, cannot re-seed. Not the bug.
        if (depsArg.elements.length === 0) return;

        // The dependency identifiers we can name (top-level identifiers only).
        const depNames = new Set(
          depsArg.elements
            .filter((el) => el?.type === "Identifier")
            .map((el) => el.name),
        );
        if (depNames.size === 0) return;

        // Body must be nothing but state setters (under optional guards).
        const body =
          effectFn.body.type === "BlockStatement"
            ? collectSetters(effectFn.body.body)
            : isSetterCall(effectFn.body)
              ? [effectFn.body]
              : null;
        if (!body || body.length === 0) return;

        // Flag only if a setter READS a dependency (the seed source). That
        // excludes reset-to-constant effects where `open` is used purely as a
        // guard and no setter reads any dependency. A FUNCTIONAL updater
        // (`setX(prev => ...)`) is skipped: it merges into / prunes the
        // existing state rather than overwriting it, so referencing a dep there
        // (e.g. `setIds(prev => prune(prev, selectableIds))`) is not a
        // destructive re-seed and must not be flagged.
        const referenced = new Set();
        for (const setter of body) {
          for (const arg of setter.arguments) {
            if (
              arg?.type === "ArrowFunctionExpression" ||
              arg?.type === "FunctionExpression"
            ) {
              continue;
            }
            collectReferencedIdentifiers(arg, referenced);
          }
        }

        for (const element of depsArg.elements) {
          if (element?.type !== "Identifier") continue;
          if (referenced.has(element.name)) {
            // Report on the `useEffect(...)` call itself (not the dep element)
            // so an `// eslint-disable-next-line` for a confirmed benign case
            // sits cleanly on the line directly above the hook call.
            context.report({
              node,
              messageId: "seedInEffect",
              data: { dep: element.name },
            });
            // One report per effect is enough signal.
            return;
          }
        }
      },
    };
  },
};
