import { describe, it } from "bun:test";
import { RuleTester } from "eslint";

import { noPodLocalEntityState } from "./no-pod-local-entity-state.mjs";

// Drive ESLint's RuleTester through bun:test's describe/it so failures surface
// as normal test cases (RuleTester calls these statics internally).
RuleTester.describe = (text, fn) => describe(text, fn);
RuleTester.it = (text, fn) => it(text, fn);
RuleTester.itOnly = (text, fn) => it(text, fn);

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// A path inside a backend plugin's src tree (the rule's structural scope).
const BACKEND = "/repo/core/incident-backend/src/index.ts";
// A path OUTSIDE any backend plugin (rule must be a no-op here).
const NON_BACKEND = "/repo/core/incident-common/src/index.ts";

ruleTester.run("no-pod-local-entity-state", noPodLocalEntityState, {
  valid: [
    // PASS: read calls a `createXEntityRead` factory (the real-site shape).
    {
      filename: BACKEND,
      code: `entityPoint.defineEntity({ kind: "incident", state: s, read: createIncidentEntityRead(service) });`,
    },
    // PASS: arrow body returns a createXEntityRead(...)() call (catalog shape).
    {
      filename: BACKEND,
      code: `defineEntity({ kind: "system", state: s, read: (ids) => createCatalogSystemEntityRead(svc())(ids) });`,
    },
    // PASS: block body returns a createXEntityRead call (incident/health shape).
    {
      filename: BACKEND,
      code: `defineEntity({ kind: "health", state: s, read: (ids) => { const db = x; return createHealthEntityRead({ db, service })(ids); } });`,
    },
    // PASS: read reads the db directly (.select / db receiver).
    {
      filename: BACKEND,
      code: `defineEntity({ kind: "k", state: s, read: (ids) => db.select().from(t).where(inArray(t.id, ids)) });`,
    },
    // PASS: read delegates to a batched service getMany* read.
    {
      filename: BACKEND,
      code: `defineEntity({ kind: "k", state: s, read: (ids) => service.getManyEntityStates(ids) });`,
    },
    // PASS: read follows a same-file local function that is db-backed.
    {
      filename: BACKEND,
      code: `const readState = (ids) => db.select().from(t); defineEntity({ kind: "k", state: s, read: readState });`,
    },
    // PASS: a pod-local kind explicitly allow-listed is suppressed.
    {
      filename: BACKEND,
      code: `defineEntity({ kind: "ws-registry", state: s, read: (ids) => connections.get(ids[0]) });`,
      options: [{ allowedKinds: ["ws-registry"] }],
    },
    // PASS: an opaque accessor named in durableAccessors is trusted.
    {
      filename: BACKEND,
      code: `defineEntity({ kind: "k", state: s, read: opaqueRead });`,
      options: [{ durableAccessors: ["opaqueRead"] }],
    },
    // Structural scope: a pod-local read OUTSIDE a backend plugin is ignored.
    {
      filename: NON_BACKEND,
      code: `defineEntity({ kind: "k", state: s, read: (ids) => cache.get(ids[0]) });`,
    },
    // Not a defineEntity call → ignored.
    {
      filename: BACKEND,
      code: `someOther({ read: (ids) => cache.get(ids[0]) });`,
    },
  ],

  invalid: [
    // pod-local: read constructs/reads a new Map.
    {
      filename: BACKEND,
      code: `const m = new Map(); defineEntity({ kind: "k", state: s, read: (ids) => ids.map((id) => m.get(id)) });`,
      errors: [{ messageId: "podLocalRead" }],
    },
    // pod-local: read reads `.get(` on a non-db, module-scoped structure.
    {
      filename: BACKEND,
      code: `defineEntity({ kind: "k", state: s, read: (ids) => connections.get(ids[0]) });`,
      errors: [{ messageId: "podLocalRead" }],
    },
    // pod-local: read constructs a new Map inline (the in-memory store shape).
    {
      filename: BACKEND,
      code: `defineEntity({ kind: "k", state: s, read: (ids) => { const store = new Map(); return store; } });`,
      errors: [{ messageId: "podLocalRead" }],
    },
    // needs-assertion: read is an opaque imported identifier (no shape, not local).
    {
      filename: BACKEND,
      code: `defineEntity({ kind: "k", state: s, read: importedOpaqueRead });`,
      errors: [{ messageId: "needsAssertion" }],
    },
    // needs-assertion: arrow body delegates to an opaque non-durable-shaped call.
    {
      filename: BACKEND,
      code: `defineEntity({ kind: "k", state: s, read: (ids) => mysteryFetch(ids) });`,
      errors: [{ messageId: "needsAssertion" }],
    },
    // pod-local wins over durable when a read mixes both signals.
    {
      filename: BACKEND,
      code: `defineEntity({ kind: "k", state: s, read: (ids) => { db.select(); return cache.get(ids[0]); } });`,
      errors: [{ messageId: "podLocalRead" }],
    },
  ],
});
