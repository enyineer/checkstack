export const meta = {
  name: "authed-e2e-buildout",
  description:
    "Author + verify + validate authenticated Playwright E2E specs for each app area, looping <=3 per area until green & complete",
  phases: [
    { title: "Author", detail: "one agent per app area writes its spec (no running)" },
    { title: "Verify", detail: "sequentially run+fix each area, then validate; loop <=3" },
  ],
};

const E2E_DIR =
  "/Users/nicoenking/Development/Projects/node/checkstack-wt/integration/core/e2e";
const REPO =
  "/Users/nicoenking/Development/Projects/node/checkstack-wt/integration";

// Shared conventions every author/fixer must follow. The harness already logs
// in as an admin (storageState) and resets to a FRESH, EMPTY database on every
// playwright invocation, so the only pre-existing data is the admin user.
const CONVENTIONS = `
HARNESS FACTS (do not re-derive):
- The browser is ALREADY authenticated as an admin via storageState. Just
  navigate with page.goto(<route>). baseURL is http://localhost:3100.
- Routes are SPA paths (e.g. "/catalog/", "/automation/"). They render the
  authenticated app, NOT a login screen.
- Each "bunx playwright test <file>" invocation boots its OWN backend against a
  FRESHLY RESET, EMPTY Postgres database and onboards the admin first (the
  "setup" project). So at the start of a spec file the ONLY data is the admin
  user; everything else is empty. Create any prerequisites (a system, a secret,
  etc.) within the spec via the UI.

SPEC FILE RULES:
- Path: ${E2E_DIR}/tests/<id>.spec.ts  (id given per area below).
- Import ONLY: import { test, expect } from "@checkstack/test-utils-frontend/playwright";
- Because the whole file shares ONE fresh DB, put at the top:
    test.describe.configure({ mode: "serial" });
  and order tests so empty-state assertions run before create/edit tests.
- Prefer robust, semantic locators: getByRole, getByLabel, getByText,
  getByPlaceholder, getByRole("button"/"link"/"heading", { name }). READ the
  component source to get exact headings/labels/placeholders/button text. Do NOT
  invent selectors; do NOT use brittle CSS/nth-child chains.
- Use web-first assertions: await expect(locator).toBeVisible() etc. Never use
  page.waitForTimeout for synchronization. Give navigations generous timeouts.
- Give created resources unique names (e.g. include Date.now()) to avoid clashes.
- Cover the HAPPY PATHS and the EDGE CASES listed for the area.
- TypeScript: no "any", no eslint-disable. Match the existing spec style in
  ${E2E_DIR}/tests/smoke.spec.ts and tests/user-guide.spec.ts.
- Do NOT modify shared files: auth.setup.ts, support/auth.ts, playwright.config.ts,
  smoke.spec.ts, user-guide.spec.ts. Only create tests/<id>.spec.ts (and, if
  truly needed, tests/support/<id>.helpers.ts).
`;

// Each area: id (spec filename stem), title, and a brief (routes, source to read,
// happy paths, edge cases, prerequisites). Agents read the source themselves.
const GROUPS = [
  {
    id: "catalog",
    title: "Systems & Catalog",
    brief: `Routes: /catalog/ (browse/search systems), /catalog/config (manage systems, groups, environments), /catalog/system/:id (detail).
Read source: core/catalog-frontend/src, core/catalog-common/src.
Happy paths: empty catalog shows an empty state with a link to config; create a system (name/description/required fields) on the config page; the new system then appears in /catalog/ browse; open the system detail page; edit the system; create a group and view it.
Edge cases: form validation when required fields (name/description) are empty; duplicate system name rejected; filtered/search empty state ("no matches") with a clear-filters affordance; delete a system with its confirmation.
Prereq: none (this area creates the root entity others depend on).`,
  },
  {
    id: "healthcheck",
    title: "Health checks",
    brief: `Routes: /healthcheck/config (list+manage), /healthcheck/config/create (strategy picker), /healthcheck/config/:id/edit (IDE), /healthcheck/history.
Read source: core/healthcheck-frontend/src, core/healthcheck-common/src.
Happy paths: empty list state; create a health check (pick a simple strategy e.g. HTTP/DNS, fill config, save); it appears in the list; open the edit IDE; view the history page (empty initially).
Edge cases: strategy picker renders available strategies; invalid/empty config shows validation errors in the editor; saving without required fields blocked; delete a config with confirmation.
Prereq: a system may be needed for assignment - create one via the catalog UI if assignment is exercised, otherwise focus on config CRUD.`,
  },
  {
    id: "automation",
    title: "Automations",
    brief: `Routes: /automation/ (list), /automation/new (create), /automation/:id (edit visual+YAML), /automation/:id/runs.
Read source: core/automation-frontend/src, core/automation-common/src.
Happy paths: empty list state; create a new automation (set name, a trigger, at least one action) and save; it appears in the list; open it and toggle enable/disable; switch between Visual and YAML tabs and confirm round-trip (no data loss).
Edge cases: saving with no trigger or no actions is prevented/validated; invalid YAML shows an error; delete an automation with confirmation; the runs page renders an empty state.
Prereq: none required for CRUD.`,
  },
  {
    id: "incident",
    title: "Incidents",
    brief: `Routes: /incident/config (manage), /incident/:id (detail), /incident/system/:systemId/incidents (history).
Read source: core/incident-frontend/src, core/incident-common/src.
Happy paths: empty incidents state; create an incident (requires a system - create one via catalog first); open its detail; change status (e.g. to resolved).
Edge cases: creating an incident without a system is validated; empty list state; status transitions reflected in the UI.
Prereq: create a system via the catalog UI in a beforeAll/first test.`,
  },
  {
    id: "maintenance",
    title: "Maintenance windows",
    brief: `Routes: /maintenance/config (manage), /maintenance/:id (detail), /maintenance/system/:systemId/history.
Read source: core/maintenance-frontend/src, core/maintenance-common/src.
Happy paths: empty state; create a maintenance window (system + start/end + reason); open detail; edit.
Edge cases: end-before-start validation; required-field validation; empty list state; delete with confirmation.
Prereq: create a system via catalog UI first.`,
  },
  {
    id: "slo",
    title: "SLOs",
    brief: `Routes: /slo/ (overview), /slo/config (manage), /slo/:id (detail).
Read source: core/slo-frontend/src, core/slo-common/src.
Happy paths: overview renders (empty); create an SLO (system + target %) on config; open detail.
Edge cases: target % out-of-range validation (0-100); required-field validation; empty states.
Prereq: create a system via catalog UI first (SLOs target a system).`,
  },
  {
    id: "notification",
    title: "Notifications & subscriptions",
    brief: `Routes: /notification/ (inbox), /notification/settings (subscriptions).
Read source: core/notification-frontend/src, core/notification-common/src.
Happy paths: inbox renders with an empty state (no notifications yet); settings page renders the subscription manager; the navbar notification bell is present.
Edge cases: empty inbox messaging; a subscription row's channel/timing controls render; mark-as-read affordance if present.
Prereq: none (meaningful events are out of scope; focus on page render + empty/settings UI).`,
  },
  {
    id: "secrets",
    title: "Secrets",
    brief: `Routes: /secrets/ (admin).
Read source: core/secrets-frontend/src, core/secrets-common/src.
Happy paths: empty secrets state; create a secret (name + value); it appears in the list showing metadata (name, hasValue) but NEVER the value; rotate it; delete it with confirmation.
Edge cases: duplicate name validation; required-field validation; the value is never displayed back.
Prereq: none.`,
  },
  {
    id: "integration",
    title: "Integrations & connections",
    brief: `Routes: /integration/ (landing, lists providers), /integration/connections/:providerId (manage connections).
Read source: core/integration-frontend/src, core/integration-common/src.
Happy paths: landing lists available providers; open a provider's connections page; the add-connection form renders.
Edge cases: missing-credential/required-field validation on the connection form; empty connections state.
Prereq: none (use whatever providers are registered; do not require real external credentials - test form validation, not a live connection).`,
  },
  {
    id: "dependency",
    title: "Dependencies & map",
    brief: `Routes: /dependency/map (graph).
Read source: core/dependency-frontend/src, core/dependency-common/src.
Happy paths: map page renders; with no systems it shows an empty/instructional state; create two systems via catalog and add a dependency between them (via the system detail/editor), then the map reflects it.
Edge cases: empty map state; search/filter toolbar renders.
Prereq: create systems via catalog UI for the dependency flow.`,
  },
  {
    id: "profile",
    title: "Auth: profile, password, strategies",
    brief: `Routes: /auth/profile (profile), /change-password, /auth/settings (strategy management).
Read source: core/auth-frontend/src.
Happy paths: profile page renders the admin's name/email; auth settings page lists strategies (credential enabled); change-password form renders.
Edge cases: change-password validation (mismatch / weak password) WITHOUT actually changing it to a value that would break later setup (prefer asserting validation errors, do not submit a real password change); logout via the user menu returns to the login screen (do this LAST in a serial file, as it ends the session).
Prereq: none.`,
  },
  {
    id: "pluginmanager",
    title: "Plugin manager",
    brief: `Routes: /pluginmanager/ (installed list), /pluginmanager/install (wizard), /pluginmanager/events (log).
Read source: core/pluginmanager-frontend/src, core/pluginmanager-common/src.
Happy paths: installed list renders active plugins with versions/status; events page renders the lifecycle log; install page renders the wizard.
Edge cases: install form validation (invalid input); empty/zero-state areas if any.
Prereq: none (do NOT actually install/uninstall a plugin - that could destabilize the run; test rendering + form validation only).`,
  },
  {
    id: "gitops",
    title: "GitOps & kind registry",
    brief: `Routes: /gitops/ (providers), /gitops/kinds (kind registry).
Read source: core/gitops-frontend/src, core/gitops-common/src.
Happy paths: providers page renders (empty/no providers configured state); kind registry page lists available kinds.
Edge cases: empty providers state messaging.
Prereq: none.`,
  },
  {
    id: "satellite",
    title: "Satellites",
    brief: `Routes: /satellite/ (list).
Read source: core/satellite-frontend/src, core/satellite-common/src.
Happy paths: list renders with an empty state (no satellites registered).
Edge cases: empty-state messaging; any register/instructions affordance renders.
Prereq: none (registration is backend/agent-driven; assert the read UI).`,
  },
  {
    id: "apidocs",
    title: "API docs",
    brief: `Routes: /api-docs/ (interactive docs).
Read source: core/api-docs-frontend/src, core/api-docs-common/src.
Happy paths: the API docs page renders with endpoints/schema content (not a blank page, not "Route not found").
Edge cases: search/filter affordance if present.
Prereq: none.`,
  },
  {
    id: "announcement",
    title: "Announcements",
    brief: `Routes: /announcement/manage (manage).
Read source: core/announcement-frontend/src, core/announcement-common/src.
Happy paths: empty announcements state; create an announcement (title + body); it appears; edit/delete it; an active announcement surfaces on the dashboard ("/") as a card/banner.
Edge cases: required-field validation; delete confirmation; expired/empty handling if visible.
Prereq: none.`,
  },
  {
    id: "infrastructure",
    title: "Infrastructure (queue/cache)",
    brief: `Routes: /infrastructure/config (multi-tab: Queue, Cache, ...).
Read source: core/infrastructure-frontend/src, core/queue-frontend/src.
Happy paths: the infrastructure page renders with its tabs; the Queue tab shows status (lag/processor) without crashing; switching tabs works.
Edge cases: a tab the user lacks access to is hidden (admin has all, so just assert present tabs render); informational state when no backend metrics.
Prereq: none.`,
  },
  {
    id: "navigation",
    title: "Navigation, user menu & access",
    brief: `Cross-cutting. Read source: core/frontend/src/App.tsx, core/auth-frontend/src/components/LoginPage.tsx (LoginNavbarAction/UserMenu), the navbar slots.
Happy paths: the user menu (button showing the admin name) opens and shows grouped entries; clicking key entries (e.g. Catalog, Automations, Health Checks) navigates to the right route and renders that page (not "Route not found"); the global Search/command affordance is present.
Edge cases: an unknown route (e.g. /this-does-not-exist) renders the NotFound ("Route not found") page; the AI assistant page route (/ai/chat) renders its shell without crashing even if no model is configured.
Prereq: none. Keep this file independent of created data.`,
  },
];

// ---- JSON schemas for structured agent returns -----------------------------
const RUN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["green", "summary", "errors", "appBugs"],
  properties: {
    green: {
      type: "boolean",
      description: "true only if the playwright run for this spec passed with 0 failures",
    },
    summary: { type: "string", description: "1-3 sentence outcome summary" },
    errors: {
      type: "string",
      description: "Key failure messages / what was wrong (empty if green)",
    },
    appBugs: {
      type: "array",
      description: "Real application bugs discovered (NOT spec problems). Empty if none.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail"],
        properties: {
          title: { type: "string" },
          detail: {
            type: "string",
            description: "What's broken, repro, and file refs (path:line) if known",
          },
        },
      },
    },
  },
};

const VAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["complete", "gaps", "suggestions"],
  properties: {
    complete: {
      type: "boolean",
      description:
        "true only if the spec is GREEN and covers the area's key happy paths AND edge cases (or remaining gaps are explicitly justified)",
    },
    gaps: {
      type: "array",
      items: { type: "string" },
      description: "Specific missing/weak coverage or incorrect assertions to fix",
    },
    suggestions: { type: "string", description: "Concrete next-iteration guidance" },
  },
};

// ---- prompts ---------------------------------------------------------------
function authorPrompt(g) {
  return `You are authoring an authenticated Playwright E2E spec for the Checkstack app area: "${g.title}".

${CONVENTIONS}

AREA BRIEF (id: ${g.id}):
${g.brief}

TASK: Read the relevant frontend source listed above to learn the real routes,
headings, labels, button text and placeholders. Then WRITE the spec file
${E2E_DIR}/tests/${g.id}.spec.ts covering the happy paths AND edge cases with
robust semantic locators and web-first assertions.

DO NOT run playwright, a server, typecheck, lint, or any long-running command in
this phase (other agents are writing files concurrently and a server port is
shared). ONLY read source and write the one spec file. When done, reply with a
one-line confirmation of the file path and the tests you wrote.`;
}

function runFixPrompt(g, feedback, attempt) {
  return `You are verifying & fixing the authenticated Playwright E2E spec for the Checkstack app area "${g.title}" (id: ${g.id}, attempt ${attempt}/3).

${CONVENTIONS}

AREA BRIEF:
${g.brief}

RUN IT (this is the ONLY place a server runs - it is safe, runs are serialized):
  cd ${E2E_DIR} && (lsof -ti:3100 | xargs kill -9 2>/dev/null; true) && bunx playwright test ${g.id}.spec.ts --reporter=line
Use a Bash timeout of 300000 ms. The harness auto-boots a fresh backend, resets
an empty DB, and onboards the admin (the "setup" project) before your spec runs.

Then:
1. If it PASSED (0 failures): you're done - report green=true with a summary.
2. If it FAILED: read the output AND the page snapshots in
   ${E2E_DIR}/test-results/*/error-context.md to see the real DOM. Decide for
   each failure whether it is:
   (a) a SPEC problem (wrong selector/route/assumption) -> FIX
       ${E2E_DIR}/tests/${g.id}.spec.ts to match the real UI, then RE-RUN.
   (b) a flow genuinely un-testable in this harness (needs an external
       service/model/credentials) -> wrap just that test in test.fixme(..., with
       a clear reason) so the FILE goes green; note it in the summary.
   (c) a REAL APPLICATION BUG -> do NOT edit app code. Add it to appBugs with
       file refs. To keep the file green, mark that one test
       test.fixme(..., "BLOCKED: app bug: <short desc>") and report the bug.
3. Re-run until the file is GREEN (0 failures) or you've exhausted reasonable
   fixes this attempt. ${feedback ? "\nFEEDBACK FROM PRIOR ITERATION (address it - includes validator gaps to also cover):\n" + feedback : ""}

Only edit ${E2E_DIR}/tests/${g.id}.spec.ts (and optionally a tests/support/${g.id}.helpers.ts). Never touch shared harness files or app source.
Return the structured result.`;
}

function validatePrompt(g, run) {
  return `You are the INDEPENDENT validator for the authenticated E2E spec of Checkstack area "${g.title}" (id: ${g.id}). Be skeptical.

AREA BRIEF (the coverage target):
${g.brief}

The latest run result was: green=${run.green}. Summary: ${run.summary}
${run.errors ? "Errors: " + run.errors : ""}

TASK (read-only - do NOT run playwright or a server):
- Read the spec ${E2E_DIR}/tests/${g.id}.spec.ts and the relevant frontend
  source.
- CORRECTNESS: are the locators/assertions real and meaningful? Flag any
  tautological/no-op assertions, selectors that don't exist in the source, tests
  that don't actually exercise the described flow, or test.fixme used to hide a
  real bug rather than a genuine harness limitation.
- COMPLETENESS: are the area's key HAPPY PATHS and EDGE CASES from the brief
  covered? List concrete missing/weak coverage.
- Set complete=true ONLY if the spec is green AND coverage is sufficient (or
  remaining gaps are explicitly justified, e.g. a documented test.fixme for an
  external dependency). Otherwise complete=false with specific gaps.
Return the structured result.`;
}

// ---- orchestration ---------------------------------------------------------
phase("Author");
log(`Authoring ${GROUPS.length} authed E2E specs in parallel...`);
await parallel(
  GROUPS.map((g) => () =>
    agent(authorPrompt(g), { label: `author:${g.id}`, phase: "Author" }),
  ),
);

phase("Verify");
const results = [];
for (const g of GROUPS) {
  let green = false;
  let complete = false;
  let attempt = 0;
  let summary = "";
  const appBugs = [];
  let feedback = "";

  while (attempt < 3 && !(green && complete)) {
    attempt++;
    const run = await agent(runFixPrompt(g, feedback, attempt), {
      label: `runfix:${g.id}#${attempt}`,
      phase: "Verify",
      schema: RUN_SCHEMA,
    });
    green = !!run?.green;
    summary = run?.summary ?? summary;
    if (Array.isArray(run?.appBugs)) appBugs.push(...run.appBugs);

    const val = await agent(validatePrompt(g, run ?? { green, summary, errors: "" }), {
      label: `validate:${g.id}#${attempt}`,
      phase: "Verify",
      schema: VAL_SCHEMA,
    });
    complete = !!val?.complete && green;
    feedback = JSON.stringify({
      runErrors: run?.errors ?? "",
      validatorGaps: val?.gaps ?? [],
      validatorSuggestions: val?.suggestions ?? "",
    });
  }

  results.push({ group: g.id, title: g.title, green, complete, attempts: attempt, summary, appBugs });
  log(`[${g.id}] green=${green} complete=${complete} attempts=${attempt}`);
}

const greenCount = results.filter((r) => r.green).length;
const completeCount = results.filter((r) => r.complete).length;
const allBugs = results.flatMap((r) => r.appBugs.map((b) => ({ group: r.group, ...b })));
log(`Done. green ${greenCount}/${results.length}, complete ${completeCount}/${results.length}, appBugs ${allBugs.length}`);

return { results, greenCount, completeCount, total: results.length, appBugs: allBugs };
