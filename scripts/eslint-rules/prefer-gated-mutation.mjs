/**
 * Custom ESLint rule: prefer-gated-mutation
 *
 * Nudges a plugin-client mutation toward the gate-fused variant so that
 * authorization is inseparable from the call:
 *
 *   client.updateAutomation.useMutation(...)        // raw — gate lives elsewhere
 *   client.updateAutomation.useGatedMutation(...)   // fused — { allowed } on the same object
 *
 * Fusing (`useGatedMutation`) derives the authorization verdict from the SAME
 * contract procedure and input the call uses, so a control can't call `mutate`
 * without holding the verdict and the two can never drift. This rule makes the
 * fused variant the default; raw `.useMutation()` becomes the deliberate,
 * greppable exception.
 *
 * LIMITATION (why this is a `warn`, not an `error`): a syntactic rule cannot
 * tell a single-instance mutation (should fuse) from one that is legitimately
 * ungated - a global/admin action, or a per-ROW mutation gated as an array via
 * `useResourceAccess` (one mutation instance, many rows, no single id to fuse).
 * Those are real and correct; suppress them with an `eslint-disable-next-line`
 * carrying the reason. A type-aware version could read the procedure's
 * `instanceAccess` and flag only gated procedures, eliminating the false
 * positives.
 */

export const preferGatedMutation = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Prefer .useGatedMutation() over raw .useMutation() so authorization is fused into the call and cannot drift from it.",
      recommended: false,
    },
    messages: {
      preferGated:
        "Prefer `.useGatedMutation()` here so the authorization gate is derived from this procedure's contract and fused onto the call ({ allowed }). If this mutation is intentionally ungated (a global/admin action) or gated per-row via useResourceAccess, suppress this line with a reason.",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        // Match `<something>.useMutation(...)` — a member call whose property is
        // exactly `useMutation`. The plugin client shape is
        // `client.<proc>.useMutation(...)`, so require a nested member access
        // (the `.proc.` between the object and `.useMutation`) to avoid flagging
        // unrelated `useMutation` identifiers.
        const callee = node.callee;
        if (
          callee?.type !== "MemberExpression" ||
          callee.property?.type !== "Identifier" ||
          callee.property.name !== "useMutation"
        ) {
          return;
        }
        // callee.object should itself be a member expression (client.proc),
        // i.e. a procedure accessor, not a bare `foo.useMutation`.
        if (callee.object?.type !== "MemberExpression") return;

        context.report({ node: callee.property, messageId: "preferGated" });
      },
    };
  },
};
