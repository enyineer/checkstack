/**
 * Custom ESLint rule: no-pod-local-entity-state
 *
 * Horizontal-scale safety tripwire for the reactive automation engine. It
 * enforces `.claude/rules/state-and-scale.md`: a reactive entity's CURRENT
 * state must be globally readable from shared/durable storage (the plugin's
 * own Postgres tables, or a derivation of them), NEVER from process-local /
 * pod-local memory. Scope enrichment and `wait_until` re-evaluation run on
 * whichever pod claims the dispatch/wake job, so a pod-local `read` means a
 * value written on pod A is invisible to pod B and the automation reads
 * stale/empty state.
 *
 * ## Honest scope (ESLint's single-file limits)
 *
 * This is a FORCING-FUNCTION tripwire at the `defineEntity({ ... })` boundary,
 * NOT a sound cross-module dataflow analysis. It only sees what is visible in
 * the file containing the `defineEntity` call (plus a same-file function the
 * `read` directly names). The class of bug it CANNOT catch: a `read` that
 * delegates to an imported accessor whose body (in another module) closes over
 * an in-memory map. For that case the rule emits the `needsAssertion` warning
 * so the author confirms durability and suppresses with a reason. The
 * authoritative deterministic check is the cross-pod IT test
 * (`cross-pod-read-consistency.it.test.ts`).
 *
 * It fires only inside backend plugin source (`core/*-backend/src` /
 * `plugins/*-backend/src`), where reactive entities are defined.
 *
 * ## What is inspected: the `read` property of `defineEntity({ ..., read })`
 *
 * The rule classifies the `read` value (whatever node it resolves to — a same-
 * file referenced function is followed) into one of three outcomes:
 *
 *   PASS (quiet) — the read visibly resolves to durable storage:
 *     - it references a db-ish receiver (`db`, `tx`, `trx`, `database`, `conn`)
 *       or a drizzle query builder (`.select(`, `.from(`, `.query.`), OR
 *     - it calls a DURABLE-ACCESSOR-shaped function: a name matching
 *       `/^create[A-Z]\w*Read$/` (the repo's `createXEntityRead` factory
 *       convention) or `/^getMany/` / `/EntityStates?$/` (batched service
 *       reads), OR a name listed in the `durableAccessors` option.
 *     These shapes cover all current real sites: `createSatelliteConnectionRead`,
 *     `createCatalogSystemEntityRead`, `createIncidentEntityRead`,
 *     `createMaintenanceEntityRead`, `createDependencyEntityRead`,
 *     `createHealthEntityRead`, and `service.getManyEntityStates`.
 *
 *   WARN (`podLocalRead`) — the read visibly touches in-memory state:
 *     - it constructs / reads a `new Map` / `new Set`, OR
 *     - it calls `.get(` / `.has(` on something that is NOT a db-ish receiver
 *       and is NOT a durable-accessor call result.
 *     This is the smoking gun for pod-local entity state.
 *
 *   WARN (`needsAssertion`) — the rule genuinely cannot tell. The `read` is an
 *     opaque value (e.g. a bare imported identifier whose definition is not in
 *     this file, with no recognizable durable shape). The author must confirm
 *     the read is durable and suppress with a reason.
 *
 * The PASS heuristics are deliberately tuned to keep the ~7 real, durable sites
 * quiet — a little under-detection (a durable read mis-shaped as PASS) is
 * preferred over noise that gets blanket-suppressed. If a legitimately-durable
 * accessor is mis-flagged, add its name to `durableAccessors` rather than
 * suppressing.
 *
 * ## Suppression / configuration
 *
 * Standard inline suppression with a reason:
 *   // eslint-disable-next-line checkstack/no-pod-local-entity-state -- <why durable>
 *
 * Options (all optional):
 *   {
 *     // Entity kinds (the literal `kind:` value) exempt from the check.
 *     allowedKinds: string[],
 *     // Extra durable-accessor function names that resolve to shared storage
 *     // but don't match the built-in name shapes.
 *     durableAccessors: string[],
 *   }
 *
 * Severity is wired as `warn` in `eslint.config.mjs`, NEVER `error`, per
 * `.claude/rules/code-style-guide.md` ("do NOT escalate warnings to errors").
 */

/** Only fire inside a backend plugin's source tree. */
const BACKEND_PLUGIN_REGEX =
  /(?:^|[\\/])(?:core|plugins)[\\/][^\\/]*-backend[\\/]src[\\/]/;

/** db-ish receiver tail names that signal durable storage. */
const DB_RECEIVER_REGEX = /^(db|tx|trx|database|conn)$/i;

/**
 * Durable-accessor function-name shapes (the repo's batched-read conventions):
 *   - `createXEntityRead` / `createXRead`  → the `EntityRead` factory pattern.
 *   - `getMany...`                          → batched service read.
 *   - `...EntityState` / `...EntityStates`  → service projection reads.
 */
const DURABLE_ACCESSOR_NAME_REGEX =
  /^create[A-Z]\w*Read$|^getMany|EntityStates?$/;

/** Drizzle / query-builder method names that signal a real DB read. */
const DURABLE_METHOD_REGEX = /^(select|from|query)$/;

/** In-memory accessor methods (only meaningful off a non-db, non-durable receiver). */
const IN_MEMORY_METHOD_REGEX = /^(get|has)$/;

/**
 * Resolve a member/identifier callee to its trailing property/identifier name.
 * @param {object} node
 * @returns {string | undefined}
 */
function calleeTailName(node) {
  if (!node) return;
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed) {
    return node.property.type === "Identifier" ? node.property.name : undefined;
  }
  return;
}

/**
 * Resolve the receiver (object) tail name of a member call, e.g. the `cache`
 * in `cache.get(...)` or `db` in `this.db.select(...)`.
 * @param {object} node
 * @returns {string | undefined}
 */
function receiverTailName(node) {
  if (!node || node.type !== "MemberExpression") return;
  const object = node.object;
  if (object.type === "Identifier") return object.name;
  if (object.type === "MemberExpression" && !object.computed) {
    return object.property.type === "Identifier"
      ? object.property.name
      : undefined;
  }
  return;
}

/**
 * Find the property named `propName` on an ObjectExpression.
 * @param {object} objectExpression
 * @param {string} propName
 * @returns {object | undefined} the Property node
 */
function findProperty(objectExpression, propName) {
  if (!objectExpression || objectExpression.type !== "ObjectExpression") return;
  for (const property of objectExpression.properties) {
    if (property.type !== "Property" || property.computed) continue;
    const key = property.key;
    const name =
      key.type === "Identifier"
        ? key.name
        : key.type === "Literal" && typeof key.value === "string"
          ? key.value
          : undefined;
    if (name === propName) return property;
  }
  return;
}

/** @returns {string | undefined} the string value of a literal `kind:` prop. */
function literalKind(objectExpression) {
  const kindProp = findProperty(objectExpression, "kind");
  if (!kindProp) return;
  const value = kindProp.value;
  return value.type === "Literal" && typeof value.value === "string"
    ? value.value
    : undefined;
}

export const noPodLocalEntityState = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Reactive entity `read` accessors must resolve from shared/durable storage, never process-local memory (.claude/rules/state-and-scale.md).",
      recommended: false,
    },
    messages: {
      podLocalRead:
        "Reactive entity `read` reads process-local (pod-local) memory (a Map/Set or `.get`/`.has` on an in-memory structure). A reactive entity's current state MUST be globally readable from shared/durable storage (the plugin's own Postgres tables) so a write on pod A is visible on pod B — see .claude/rules/state-and-scale.md. Route `read` through the plugin's durable tables (a `createXEntityRead`/`getMany*` accessor), or, for genuinely pod-local bookkeeping that is NOT the source of truth, mark it with declareNonReactiveState and suppress with a reason.",
      needsAssertion:
        "Cannot statically confirm this reactive entity `read` resolves to shared/durable storage — it delegates to an opaque accessor not visible in this file. Per .claude/rules/state-and-scale.md the read MUST return the same answer on every pod. Confirm it reads the plugin's durable tables, then either name it like a durable accessor (`createXEntityRead` / `getMany*`), add its name to this rule's `durableAccessors` option, or suppress with `// eslint-disable-next-line checkstack/no-pod-local-entity-state -- <why durable>`.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowedKinds: { type: "array", items: { type: "string" } },
          durableAccessors: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const filePath = context.filename ?? context.getFilename();
    if (!BACKEND_PLUGIN_REGEX.test(filePath)) return {};

    const options = context.options[0] ?? {};
    const allowedKinds = new Set(options.allowedKinds);
    const durableAccessors = new Set(options.durableAccessors);
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** @returns {boolean} name matches a durable-accessor shape. */
    function isDurableAccessorName(name) {
      if (!name) return false;
      return durableAccessors.has(name) || DURABLE_ACCESSOR_NAME_REGEX.test(name);
    }

    /**
     * Resolve a same-file identifier to the function/arrow node it was bound
     * to (via a `const x = () => ...` / `function x() {}` declaration in this
     * file), so a `read: incidentRead` referencing a local function is followed.
     * Returns undefined for imported / non-function bindings (opaque).
     * @param {object} identifierNode
     * @returns {object | undefined} the function-like node, or undefined.
     */
    function resolveLocalFunction(identifierNode) {
      const scope = sourceCode.getScope(identifierNode);
      let current = scope;
      while (current) {
        const variable = current.variables.find(
          (v) => v.name === identifierNode.name,
        );
        if (variable) {
          for (const def of variable.defs) {
            if (def.type === "FunctionName") return def.node;
            if (
              def.type === "Variable" &&
              def.node.type === "VariableDeclarator" &&
              def.node.init &&
              (def.node.init.type === "ArrowFunctionExpression" ||
                def.node.init.type === "FunctionExpression")
            ) {
              return def.node.init;
            }
          }
          return; // bound, but not to a local function we can inspect.
        }
        current = current.upper;
      }
      return;
    }

    /**
     * Classify a `read` value node. Returns one of:
     *   { verdict: "pass" }            — visibly durable
     *   { verdict: "pod-local" }       — visibly in-memory
     *   { verdict: "needs-assertion" } — opaque
     *
     * `seen` guards against following a self-referential identifier cycle.
     * @param {object} node
     * @param {Set<object>} seen
     */
    function classify(node, seen) {
      if (!node || seen.has(node)) return { verdict: "needs-assertion" };
      seen.add(node);

      // A bare identifier: trust a durable-accessor-shaped / allow-listed name,
      // else follow it to a same-file function, else opaque.
      if (node.type === "Identifier") {
        if (isDurableAccessorName(node.name)) return { verdict: "pass" };
        const fn = resolveLocalFunction(node);
        if (fn) return classify(fn, seen);
        return { verdict: "needs-assertion" };
      }

      // Function/arrow: classify by scanning its body for the strongest signal.
      if (
        node.type === "ArrowFunctionExpression" ||
        node.type === "FunctionExpression"
      ) {
        return classifyFunctionBody(node);
      }

      // A direct call expression as the `read` value, e.g.
      // `read: createSatelliteConnectionRead(service)`.
      if (node.type === "CallExpression") {
        return classifyExpression(node);
      }

      // Anything else (member access, etc.) — inspect as an expression.
      return classifyExpression(node);
    }

    /**
     * Scan a function-like node's subtree for the strongest durability signal.
     * pod-local (in-memory) evidence wins over durable evidence (fail-toward-
     * flagging a mixed read); durable evidence wins over "no signal".
     * @param {object} fnNode
     */
    function classifyFunctionBody(fnNode) {
      let durable = false;
      let podLocal = false;

      const visit = (n) => {
        if (!n || typeof n.type !== "string") return;

        if (n.type === "NewExpression") {
          const ctor = n.callee;
          if (
            ctor.type === "Identifier" &&
            (ctor.name === "Map" || ctor.name === "Set" || ctor.name === "WeakMap")
          ) {
            podLocal = true;
          }
        }

        if (n.type === "MemberExpression" && !n.computed) {
          const recv = receiverTailName(n);
          if (recv && DB_RECEIVER_REGEX.test(recv)) durable = true;
          const prop =
            n.property.type === "Identifier" ? n.property.name : undefined;
          if (prop && DURABLE_METHOD_REGEX.test(prop)) durable = true;
        }

        if (n.type === "CallExpression") {
          const name = calleeTailName(n.callee);
          if (isDurableAccessorName(name)) durable = true;
          if (
            name &&
            IN_MEMORY_METHOD_REGEX.test(name) &&
            n.callee.type === "MemberExpression"
          ) {
            const recv = receiverTailName(n.callee);
            // `.get/.has` on a NON-db, NON-durable-accessor receiver → in-memory.
            const recvIsDb = recv && DB_RECEIVER_REGEX.test(recv);
            const recvIsDurable = isDurableAccessorName(recv);
            if (!recvIsDb && !recvIsDurable) podLocal = true;
          }
        }

        for (const key of Object.keys(n)) {
          if (key === "parent") continue;
          const child = n[key];
          if (Array.isArray(child)) {
            for (const c of child) if (c && typeof c.type === "string") visit(c);
          } else if (child && typeof child.type === "string") {
            visit(child);
          }
        }
      };

      visit(fnNode.body);

      if (podLocal) return { verdict: "pod-local" };
      if (durable) return { verdict: "pass" };
      return { verdict: "needs-assertion" };
    }

    /**
     * Classify a non-function expression used directly as `read` (e.g. a call
     * to a factory, or a member access).
     * @param {object} node
     */
    function classifyExpression(node) {
      // Reuse the body scanner by wrapping: it handles calls + members + new.
      return classifyFunctionBody({ body: node });
    }

    return {
      CallExpression(node) {
        const name = calleeTailName(node.callee);
        if (name !== "defineEntity") return;

        const arg = node.arguments[0];
        if (!arg || arg.type !== "ObjectExpression") return;

        const kind = literalKind(arg);
        if (kind && allowedKinds.has(kind)) return;

        const readProp = findProperty(arg, "read");
        if (!readProp) return; // no read prop → not our concern (type error elsewhere).

        const { verdict } = classify(readProp.value, new Set());
        if (verdict === "pod-local") {
          context.report({ node: readProp, messageId: "podLocalRead" });
        } else if (verdict === "needs-assertion") {
          context.report({ node: readProp, messageId: "needsAssertion" });
        }
      },
    };
  },
};
