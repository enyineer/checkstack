import { describe, it } from "bun:test";
import { RuleTester } from "eslint";

import { noUnmanagedEntityState } from "./no-unmanaged-entity-state.mjs";

// Drive ESLint's RuleTester through bun:test's describe/it so failures surface
// as normal test cases (RuleTester calls these statics internally).
RuleTester.describe = (text, fn) => describe(text, fn);
RuleTester.it = (text, fn) => it(text, fn);
RuleTester.itOnly = (text, fn) => it(text, fn);

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// A path inside a backend plugin's src tree (the rule's structural scope).
const BACKEND = "/repo/core/incident-backend/src/hooks.ts";
// A path OUTSIDE any backend plugin (rule must be a no-op here).
const NON_BACKEND = "/repo/core/incident-common/src/hooks.ts";

ruleTester.run("no-unmanaged-entity-state", noUnmanagedEntityState, {
  valid: [
    // (a) A non-entity-shaped hook id is fine.
    {
      filename: BACKEND,
      code: `const h = createHook("notification.delivered");`,
    },
    // (a) An entity-shaped hook id OUTSIDE a backend plugin is not flagged
    // (structural scope guard).
    {
      filename: NON_BACKEND,
      code: `const h = createHook("incident.created");`,
    },
    // (a) An entity-shaped id explicitly allow-listed is suppressed.
    {
      filename: BACKEND,
      code: `const h = createHook("auth.user.deleted");`,
      options: [{ allowedHookIds: ["auth.user.deleted"] }],
    },
    // (a) Non-literal id argument cannot be statically classified → ignored.
    {
      filename: BACKEND,
      code: `const h = createHook(buildId());`,
    },
    // (b) Direct state-column write with an EMPTY denylist (the current-phase
    // default) is a no-op.
    {
      filename: BACKEND,
      code: `db.update(incidents).set({ status: "open" });`,
    },
    // (b) Write to a denied column on an allow-listed (declared-non-reactive)
    // table is suppressed.
    {
      filename: BACKEND,
      code: `db.update(incidents).set({ status: "open" });`,
      options: [
        {
          deniedColumns: [{ table: "incidents", column: "status" }],
          allowedTables: ["incidents"],
        },
      ],
    },
    // (b) Write to a non-denied column on a denied table is fine.
    {
      filename: BACKEND,
      code: `db.update(incidents).set({ title: "x" });`,
      options: [{ deniedColumns: [{ table: "incidents", column: "status" }] }],
    },
    // (b) A `.set()` that is not a db write (unrelated receiver) is ignored.
    {
      filename: BACKEND,
      code: `cache.update(incidents).set({ status: "open" });`,
      options: [{ deniedColumns: [{ table: "incidents", column: "status" }] }],
    },
  ],

  invalid: [
    // (a) Each entity-change naming-shape suffix inside a backend plugin.
    {
      filename: BACKEND,
      code: `const h = createHook("incident.created");`,
      errors: [{ messageId: "changeHook" }],
    },
    {
      filename: BACKEND,
      code: `const h = createHook("incident.updated");`,
      errors: [{ messageId: "changeHook" }],
    },
    {
      filename: BACKEND,
      code: `const h = createHook("catalog.system.deleted");`,
      errors: [{ messageId: "changeHook" }],
    },
    {
      filename: BACKEND,
      code: `const h = createHook("healthcheck.system.health_changed");`,
      errors: [{ messageId: "changeHook" }],
    },
    {
      filename: BACKEND,
      code: `const h = createHook("incident.resolved");`,
      errors: [{ messageId: "changeHook" }],
    },
    // (a) Namespaced/member createHook (e.g. `hooks.createHook(...)`).
    {
      filename: BACKEND,
      code: `const h = api.createHook("maintenance.updated");`,
      errors: [{ messageId: "changeHook" }],
    },
    // (b) Direct write to a denied former-state column via .set().
    {
      filename: BACKEND,
      code: `db.update(incidents).set({ status: "resolved" });`,
      options: [{ deniedColumns: [{ table: "incidents", column: "status" }] }],
      errors: [{ messageId: "stateColumnWrite" }],
    },
    // (b) Direct insert to a denied former-state column via .values().
    {
      filename: BACKEND,
      code: `tx.insert(incidents).values({ status: "open", title: "x" });`,
      options: [{ deniedColumns: [{ table: "incidents", column: "status" }] }],
      errors: [{ messageId: "stateColumnWrite" }],
    },
  ],
});
