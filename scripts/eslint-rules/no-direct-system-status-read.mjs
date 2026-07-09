/**
 * Custom ESLint rule: no-direct-system-status-read
 *
 * Enforced-by-design routing of system-health reads through the status cache.
 * The derived per-system health status is expensive (an N+1 over
 * `health_check_runs` across every check × environment) and is served from a
 * per-pod cache that is kept cluster-coherent by broadcast invalidation (see
 * `cache.ts` / `SystemHealthStatusCache`). A caller that reads the raw
 * `service.getSystemHealthStatus(...)` directly bypasses that cache entirely -
 * paying the full fan-out on every request and, worse, reading a value no
 * invalidation can keep fresh.
 *
 * This rule forbids calling the configured read method(s) anywhere the scope is
 * applied. The SANCTIONED callers - the cache facade itself (the one wrapper),
 * and the executor / entity-compute paths that MUST read live to detect a
 * transition - are exempted by file in eslint.config.mjs. Everything else
 * (routers, consumers, widgets) must go through `cache.read` / `readBulk` /
 * `readMatrix`.
 *
 * It matches only a CALL of the method (`x.getSystemHealthStatus(...)`), so a
 * bare member access like an oRPC handler definition
 * (`os.getSystemHealthStatus.handler(...)`, whose call is `.handler`) never
 * trips it. Configure `methods` in eslint.config.mjs; with none the rule is
 * inert.
 *
 * Severity is `error`: it is an exact structural match (a call of a named
 * method) with no false positives, and a bypass is a real perf + staleness bug.
 */
export const noDirectSystemStatusRead = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid direct service reads of system health status outside the status cache, so every read goes through the cluster-coherent cache.",
      recommended: false,
    },
    messages: {
      directRead:
        "Direct `{{method}}(...)` bypasses the system-health status cache (SystemHealthStatusCache in core/healthcheck-backend/src/cache.ts): it pays the full per-check fan-out on every call and reads a value cross-pod invalidation cannot keep fresh. Read through `cache.read` / `cache.readBulk` / `cache.readMatrix` instead. (The cache facade and the executor/entity-compute transition reads are the only sanctioned direct callers, exempted by file.)",
    },
    schema: [
      {
        type: "object",
        properties: {
          methods: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] ?? {};
    const methods = new Set(options.methods);
    if (methods.size === 0) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier") return;
        const method = callee.property.name;
        if (!methods.has(method)) return;
        context.report({ node, messageId: "directRead", data: { method } });
      },
    };
  },
};
