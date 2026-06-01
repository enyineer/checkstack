/**
 * Custom ESLint rule: no-unmanaged-entity-state
 *
 * Backstop enforcement for the reactive automation engine (plan §6.4, §15.6).
 * Entity state must flow through `defineEntity` (the `automation.entity`
 * extension point) so it is reactive, diffed, and woven into the wake-index /
 * scope-projection pipeline. This rule is the *lint backstop* layer — the
 * primary enforcement is structural (the `ENTITY_CHANGED` hook is internal to
 * automation-backend and never exported). It informs, it does NOT block:
 * severity is wired as `warn` in `eslint.config.mjs`, NEVER `error`, per
 * `.claude/rules/code-style-guide.md` and plan §6.4 ("do NOT escalate warnings
 * to errors").
 *
 * It flags two shapes inside a backend plugin (`core/*-backend` /
 * `plugins/*-backend`):
 *
 *   (a) A `createHook(...)` call whose hook id matches the removed-hook naming
 *       shape (`*.created` / `*.updated` / `*.deleted` / `*.changed` /
 *       `*.resolved`). These are entity-change-ish hooks that should become an
 *       entity's auto-emitted change events via `defineEntity` (plan §9, §4.3).
 *
 *   (b) A direct `db.update(table)` / `db.insert(table)` write to a migrated
 *       domain's former state column. Driven entirely from a CONFIGURABLE
 *       denylist of `(table, column)` pairs (the `deniedColumns` option). No
 *       domain is migrated at this phase, so the default denylist is EMPTY and
 *       this part produces ZERO matches on the current codebase. Domains
 *       populate it as they migrate.
 *
 * ## Suppression / configuration
 *
 * Both parts are configured through the rule's options object in
 * `eslint.config.mjs` (the rule's `schema` is below). The `declareNonReactiveState`
 * escape hatch (plan §5, §15.6) is consumed at lint time as a project-config
 * ALLOWLIST OF TABLE NAMES: collecting runtime `declareNonReactiveState({ table })`
 * calls statically is unreliable (the `table` argument is frequently a Drizzle
 * table object, not a literal), so the chosen mechanism is an explicit
 * `allowedTables` list mirrored in `eslint.config.mjs`. A table in `allowedTables`
 * suppresses every `(table, column)` denylist match for that table — keeping the
 * lint allowlist and the runtime `declareNonReactiveState` declarations in sync is
 * the author's responsibility (and is checked by review).
 *
 * Options (all optional, all default to empty/minimal so the rule is a no-op on
 * the unmigrated codebase except for the naming-shape hooks):
 *
 *   {
 *     // (a) hook ids exempt from the naming-shape check (known non-entity
 *     //     "keep" hooks per plan §9, e.g. lifecycle / config-change signals).
 *     allowedHookIds: string[],
 *     // (b) migrated-domain former state columns to flag direct writes to.
 *     deniedColumns: { table: string, column: string }[],
 *     // (b) tables declared non-reactive via declareNonReactiveState — suppresses
 *     //     every deniedColumns match for these tables.
 *     allowedTables: string[],
 *   }
 */

// The removed-hook naming shape (plan §15.6): the id ends in one of the
// entity-change words, preceded by a `.` or `_` separator. The separator
// alternation catches the real-world `*.health_changed` variant (plan §9)
// alongside the canonical `*.created` / `*.updated` / `*.deleted` /
// `*.changed` / `*.resolved` shapes.
const HOOK_NAMING_SHAPE =
  /[._](created|updated|deleted|changed|resolved)$/;

/** Only fire inside a backend plugin's source tree. */
const BACKEND_PLUGIN_REGEX =
  /(?:^|[\\/])(?:core|plugins)[\\/][^\\/]*-backend[\\/]src[\\/]/;

/**
 * Resolve a CallExpression callee to a dotted member path string, e.g.
 * `db.update`, `this.db.insert`, `tx.insert`. Returns undefined for shapes we
 * don't understand (computed access, calls on call results, etc.).
 * @param {object} callee
 * @returns {string | undefined}
 */
function memberPath(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression") {
    if (callee.computed) return;
    const objectPath = memberPath(callee.object);
    const propertyName =
      callee.property.type === "Identifier" ? callee.property.name : undefined;
    if (objectPath === undefined || propertyName === undefined) return;
    return `${objectPath}.${propertyName}`;
  }
  return;
}

/**
 * Extract a table identifier from the first argument of a `.update()` /
 * `.insert()` call. Drizzle accepts either a table object (`db.insert(systems)`)
 * or — in raw SQL paths — a string. We match on the trailing identifier name so
 * `db.update(incidents)` resolves to "incidents". Returns undefined when the
 * argument is not a plain identifier/string we can statically map to a table.
 * @param {object | undefined} arg
 * @returns {string | undefined}
 */
function tableNameFromArg(arg) {
  if (!arg) return;
  if (arg.type === "Identifier") return arg.name;
  if (arg.type === "Literal" && typeof arg.value === "string") return arg.value;
  if (arg.type === "MemberExpression" && !arg.computed) {
    return arg.property.type === "Identifier" ? arg.property.name : undefined;
  }
  return;
}

/**
 * Walk an object-expression argument (the `.set({...})` / `.values({...})`
 * payload of a Drizzle write) and collect the top-level property keys.
 * @param {object | undefined} arg
 * @returns {Set<string>}
 */
function writtenColumns(arg) {
  const columns = new Set();
  if (!arg || arg.type !== "ObjectExpression") return columns;
  for (const property of arg.properties) {
    if (property.type !== "Property" || property.computed) continue;
    if (property.key.type === "Identifier") columns.add(property.key.name);
    else if (
      property.key.type === "Literal" &&
      typeof property.key.value === "string"
    )
      columns.add(property.key.value);
  }
  return columns;
}

export const noUnmanagedEntityState = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Flag entity-change-ish hooks and direct writes to migrated-domain state columns; entity state must flow through defineEntity (reactive automation engine §6.4, §15.6).",
      recommended: false,
    },
    messages: {
      changeHook:
        "Hook id '{{hookId}}' matches the entity-change naming shape ('*.created/.updated/.deleted/.changed/.resolved'). Entity state changes should be emitted via the entity's auto-emitted change events — declare the entity with defineEntity (automation.entity extension point) instead of a manual createHook. If this is intentionally NOT a reactive entity, add its id to this rule's 'allowedHookIds' option.",
      stateColumnWrite:
        "Direct write to '{{table}}.{{column}}' — this is a migrated domain's former state column. Mutate through the defineEntity handle (set/patch) so the change is reactive. If this data is intentionally non-reactive, declare it with declareNonReactiveState({{ table: '{{table}}' }}) and add '{{table}}' to this rule's 'allowedTables' option.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowedHookIds: {
            type: "array",
            items: { type: "string" },
          },
          deniedColumns: {
            type: "array",
            items: {
              type: "object",
              properties: {
                table: { type: "string" },
                column: { type: "string" },
              },
              required: ["table", "column"],
              additionalProperties: false,
            },
          },
          allowedTables: {
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

    // Structural scope: only backend plugin source. Outside it there are no
    // entity hooks to migrate and no state tables to guard.
    if (!BACKEND_PLUGIN_REGEX.test(filePath)) {
      return {};
    }

    const options = context.options[0] ?? {};
    // `new Set(undefined)` yields an empty set, so the option may be absent.
    const allowedHookIds = new Set(options.allowedHookIds);
    const allowedTables = new Set(options.allowedTables);
    // Map: table -> Set<column> of denied (migrated former-state) columns.
    const deniedColumns = new Map();
    for (const { table, column } of options.deniedColumns ?? []) {
      const set = deniedColumns.get(table) ?? new Set();
      set.add(column);
      deniedColumns.set(table, set);
    }

    return {
      // (a) createHook("<id>") with a removed-hook naming shape.
      CallExpression(node) {
        const callee = node.callee;
        const isCreateHook =
          (callee.type === "Identifier" && callee.name === "createHook") ||
          (callee.type === "MemberExpression" &&
            !callee.computed &&
            callee.property.type === "Identifier" &&
            callee.property.name === "createHook");

        if (isCreateHook) {
          const idArg = node.arguments[0];
          if (idArg?.type === "Literal" && typeof idArg.value === "string") {
            const hookId = idArg.value;
            if (
              HOOK_NAMING_SHAPE.test(hookId) &&
              !allowedHookIds.has(hookId)
            ) {
              context.report({
                node: idArg,
                messageId: "changeHook",
                data: { hookId },
              });
            }
          }
          return;
        }

        // (b) db.update(table).set({...}) / db.insert(table).values({...})
        // writing a denied (migrated former-state) column.
        if (deniedColumns.size === 0) return;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        const method =
          callee.property.type === "Identifier"
            ? callee.property.name
            : undefined;
        if (method !== "set" && method !== "values") return;

        // Walk back to the originating `.update(table)` / `.insert(table)`
        // call: `db.update(t).set({...})` → callee.object is the update call.
        const writeCall = callee.object;
        if (writeCall.type !== "CallExpression") return;
        const writeCallee = writeCall.callee;
        if (writeCallee.type !== "MemberExpression" || writeCallee.computed)
          return;
        const writeOp =
          writeCallee.property.type === "Identifier"
            ? writeCallee.property.name
            : undefined;
        if (writeOp !== "update" && writeOp !== "insert") return;
        // Make sure it looks like a db-ish receiver (`db`, `tx`, `this.db`,
        // `database`, …) rather than an unrelated `.update()`/`.insert()`.
        const receiverPath = memberPath(writeCallee.object);
        if (receiverPath === undefined) return;
        const receiverTail = receiverPath.split(".").at(-1) ?? "";
        if (!/^(db|tx|trx|database|conn)$/i.test(receiverTail)) return;

        const table = tableNameFromArg(writeCall.arguments[0]);
        if (table === undefined) return;
        if (allowedTables.has(table)) return;
        const denied = deniedColumns.get(table);
        if (!denied) return;

        const columns = writtenColumns(node.arguments[0]);
        for (const column of columns) {
          if (denied.has(column)) {
            context.report({
              node,
              messageId: "stateColumnWrite",
              data: { table, column },
            });
          }
        }
      },
    };
  },
};
