/**
 * Custom ESLint rule: no-direct-role-membership-writes
 *
 * Enforced-by-design cache invalidation for the auth read path. `readEnrichedUser`
 * serves authorization from per-pod caches of `user -> roles` and
 * `role -> access-rule ids`. Those caches are correct across horizontally-scaled
 * pods ONLY if every mutation of the backing tables - `role`, `role_access_rule`,
 * `user_role` - also evicts the entry locally AND broadcasts a cluster-wide
 * invalidation hook. `RoleMembershipStore` welds each write to that invalidation
 * so the two cannot drift; this rule forbids raw drizzle writes to those tables
 * anywhere else, so the store is the only door and a mutation site physically
 * cannot forget the invalidation.
 *
 * It fires on a drizzle write call whose first argument is a protected table:
 *   db.insert(schema.userRole)...     tx.delete(schema.roleAccessRule)...
 *   db.update(schema.role).set(...)   (also a bare `userRole` from a destructured
 *                                      `import { userRole } from "./schema"`)
 *
 * The `.select().from(schema.userRole)` READ path is untouched (`from` is not a
 * write method). Scope (auth-backend src), and the store-file / test exemptions,
 * are wired in eslint.config.mjs. Configure the protected `tables` (and optional
 * schema `namespaces`, default `["schema"]`) there; with no `tables` the rule is
 * inert.
 *
 * Severity is `error`: unlike the heuristic scale tripwires, this is an exact
 * structural match (a write call on a named table) with no false positives, and
 * a bypass is a real cross-pod authorization-staleness bug.
 */
const WRITE_METHODS = new Set(["insert", "update", "delete"]);

export const noDirectRoleMembershipWrites = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid raw insert/update/delete on the role-membership tables outside RoleMembershipStore, so cache invalidation can never be forgotten.",
      recommended: false,
    },
    messages: {
      directWrite:
        "Direct `{{method}}` on the `{{table}}` table bypasses RoleMembershipStore, so the per-pod auth caches (user -> roles, role -> access-rules) would not be invalidated + broadcast - a cross-pod authorization-staleness bug. Route this write through RoleMembershipStore (core/auth-backend/src/role-membership-store.ts), which welds the write to its cache invalidation.",
    },
    schema: [
      {
        type: "object",
        properties: {
          tables: { type: "array", items: { type: "string" } },
          namespaces: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] ?? {};
    const tables = new Set(options.tables);
    const namespaces = new Set(options.namespaces ?? ["schema"]);
    if (tables.size === 0) return {};

    /**
     * The protected table name referenced by a write call's first argument, or
     * undefined. Matches `schema.<table>` (a namespaced import) and a bare
     * `<table>` identifier (a destructured import).
     * @param {object} argNode
     * @returns {string | undefined}
     */
    function protectedTableName(argNode) {
      if (!argNode) return;
      if (
        argNode.type === "MemberExpression" &&
        !argNode.computed &&
        argNode.object.type === "Identifier" &&
        namespaces.has(argNode.object.name) &&
        argNode.property.type === "Identifier" &&
        tables.has(argNode.property.name)
      ) {
        return argNode.property.name;
      }
      if (argNode.type === "Identifier" && tables.has(argNode.name)) {
        return argNode.name;
      }
      return;
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        const method =
          callee.property.type === "Identifier"
            ? callee.property.name
            : undefined;
        if (!method || !WRITE_METHODS.has(method)) return;
        const table = protectedTableName(node.arguments[0]);
        if (!table) return;
        context.report({
          node,
          messageId: "directWrite",
          data: { method, table },
        });
      },
    };
  },
};
