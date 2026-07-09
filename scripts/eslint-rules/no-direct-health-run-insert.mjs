/**
 * Custom ESLint rule: no-direct-health-run-insert
 *
 * Enforced-by-design cache invalidation for the run write path. A system's
 * derived health status is COMPUTED from `health_check_runs`, so every insert of
 * a run potentially changes a cached status and MUST be paired with a
 * `cache.reconcile(...)` (hot path) or an `invalidate*` (bulk/lifecycle). The two
 * sanctioned run writers - the queue executor (`queue-executor.ts`, which
 * reconciles the exact (system, environment) key it just wrote) and the service
 * ingest path (`service.ts`, whose router handler invalidates the system) - already
 * do this. This rule forbids a raw `insert(healthCheckRuns)` anywhere else, so a
 * NEW run source physically cannot land runs without going through a writer that
 * reconciles the cache - a missed reconcile would strand a stale status on every
 * pod until the TTL.
 *
 * It fires on `db.insert(healthCheckRuns)` / `tx.insert(schema.healthCheckRuns)`
 * (namespaced or bare-identifier table arg). The read path
 * (`.select().from(healthCheckRuns)`) is untouched. Scope + the executor/service
 * exemptions are wired in eslint.config.mjs; configure the protected `tables`
 * (default namespaces `["schema"]`) there. With no `tables` the rule is inert.
 *
 * Severity is `error`: an exact structural match (an insert on a named table)
 * with no false positives, and a bypass is a real cross-pod status-staleness bug.
 */
export const noDirectHealthRunInsert = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid raw insert on health_check_runs outside the executor/service run writers, so status-cache reconcile can never be forgotten.",
      recommended: false,
    },
    messages: {
      directInsert:
        "Direct `insert` on the `{{table}}` table bypasses the sanctioned run writers (queue-executor.ts / service.ts), so the system-health status cache would not be reconciled + broadcast - a cross-pod status-staleness bug. Land runs through the executor or service ingest path, which weld the insert to `cache.reconcile` / invalidation.",
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
     * The protected table name referenced by the insert's first argument, or
     * undefined. Matches `schema.<table>` and a bare `<table>` identifier.
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
        if (
          callee.property.type !== "Identifier" ||
          callee.property.name !== "insert"
        ) {
          return;
        }
        const table = protectedTableName(node.arguments[0]);
        if (!table) return;
        context.report({ node, messageId: "directInsert", data: { table } });
      },
    };
  },
};
