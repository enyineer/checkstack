# @checkstack/automation-backend

## 0.2.0

### Minor Changes

- e2d6f25: feat(automation): connection picker for integration actions + restore Integrations menu

  Connection-backed automation actions (Jira, Teams, Webex) now render a
  working connection picker plus cascading provider dropdowns in the
  visual editor, and the Integrations entry is back in the user menu.

  **Contract.** `ActionDefinition` gained an optional
  `connectionProviderId` (and it is surfaced on `ActionInfoSchema` and
  mapped in the `listActions` router). It carries the integration
  provider's fully-qualified id, derived from the provider plugin's own
  `pluginMetadata.pluginId` (never a hardcoded string), so the editor
  knows which provider backs an action's dropdowns and it matches the
  `qualifiedId` the integration provider registry assigns.

  **Providers.** Jira, Teams and Webex each export
  `*_PROVIDER_LOCAL_ID` / `*_PROVIDER_QUALIFIED_ID`, register their
  provider with the local id, and add a `CONNECTION_OPTIONS`
  (`"connectionOptions"`) resolver name. Their `post_message` /
  issue actions set `connectionProviderId` and expose `connectionId`
  as an `x-options-resolver` dropdown instead of a hidden field.

  **Frontend bridge.** A new `useConnectionOptionResolvers` hook
  (`@checkstack/automation-frontend`, which now depends on
  `@checkstack/integration-common`) turns an action's
  `x-options-resolver` schema fields into live data: the
  `connectionOptions` resolver lists the provider's connections via
  `listConnections`, and every other resolver name is forwarded to
  `getConnectionOptions` for the selected `connectionId`, passing the
  live form values as `context` for dependent fields. `ProviderActionBody`
  now passes this map to `DynamicForm` (it was previously missing
  entirely, so connection-backed actions had no working dropdowns).

  **frontend-api.** `usePluginClient` procedures now also expose a typed
  imperative `.call(input)` alongside `.useQuery` / `.useMutation`, for
  async callbacks that cannot host a hook (such as a `DynamicForm`
  options resolver). Additive, non-breaking.

  **Integrations menu.** Re-added `IntegrationMenuItem` and a new
  `IntegrationsLandingPage`, wired into `integration-frontend` as a list
  route and a `UserMenuItemsSlot` entry under the "Configuration" group.

  **Action card polish.** The action editor's secondary metadata (id,
  description, failure behaviour) is now grouped into one quiet settings
  panel with consistent small uppercase "eyebrow" labels, so the action's
  own configuration stays the focal point. The raw failure checkbox was
  replaced with the standard `Checkbox` control, and the provider action
  picker / configuration sections gained consistent section headers and a
  divider. The per-step "type" dropdown was removed: an action's kind is
  fixed at creation, so changing it now means adding a new step and
  deleting the old one (avoids the surprising full-config reset that
  switching kinds used to trigger).

  **Add-step picker.** Adding a step now opens a Home-Assistant-style
  dialog where the operator decides the step type up front: an "Actions"
  tab lists the registered provider actions grouped by category
  (searchable; picking one presets the step's `action`), and a "Blocks"
  tab lists the structural building blocks (choose / parallel / repeat /
  etc.). Because the concrete action is chosen here, the in-card action
  switcher was removed - a step's action is fixed once created. Composite
  blocks now start with an empty child list (filled via the nested
  add-step picker) instead of seeding an unconfigurable empty action.

- 41c77f4: feat(automation): deep + live definition validation surfaces invalid values, keys and ids — marked inline

  Previously `validateDefinition` only checked the structural shape via
  `AutomationDefinitionSchema`, where an action's `config` is typed as
  `z.record(z.unknown())`. So a bad config value (e.g. `level:
debugthisiswrong` on `automation.log`) passed validation, and switching
  to the visual editor just showed an empty dropdown with no explanation.

  **Backend — deep validation.** New `collectDefinitionIssues` walker
  validates the whole definition semantically, not just structurally:

  - unknown trigger `event` / action `action` ids,
  - each provider action's `config` against the registered action's own
    schema (wrong enum value, missing required field, wrong type),
  - each trigger's `config` against the trigger's `configSchema`,
  - **unknown / typo'd config keys** — object configs are validated in
    strict mode, so `levle: "info"` is reported rather than silently
    stripped,
  - recurses through `choose` / `parallel` / `repeat` / `sequence` so
    nested action configs are covered too.

  Issues come back with a dot-joinable `path` (e.g.
  `actions.0.config.level`, `triggers.1.event`). The `validateDefinition`
  RPC now returns these.

  **Frontend — live + inline.** The automation editor re-validates on
  every edit (debounced ~400ms) in BOTH tabs, and marks the offending
  content in place rather than in a separate alert panel:

  - **YAML tab** — issues (and YAML syntax errors) are squiggled at the
    exact node. `@checkstack/ui`'s `CodeEditor` gained a `markers` prop;
    the editor maps each issue's `path` onto the YAML document's node
    range via a new `computeYamlMarkers` helper (walking up to the
    nearest existing ancestor when a key is absent, e.g. a missing
    required field).
  - **Visual tab** — the specific card carrying an issue is marked: a
    destructive border + warning icon + the field-level messages. A
    `ValidationProvider` context partitions issues by owner (action card
    / trigger card / condition / top-level) using the action-node path
    grammar, so a nested action's config error attaches to the nested
    card, and a `choose`'s own `when` error attaches to the choose card.
    `ActionCard` gained an `errors` prop. So importing YAML with a bad
    value (the empty-dropdown case) now visibly flags the card instead of
    being silent.

  The big error alert is gone; the only residual panel is a slim fallback
  for the rare top-level issue that can't attach to any card.

  Note: strict config validation means an action whose config schema
  intentionally allowed extra keys would now flag them; action configs
  across the platform declare all their fields, so this only catches
  genuine typos.

- e1a2077: feat(automation): reference artifacts by explicit action id (`artifacts.<id>.<name>`)

  Multiple actions of the same type (e.g. two "create Jira issue" steps) used
  to collide: both produced the artifact type `integration-jira.issue`, so a
  template could only ever reach "the most recent one of that type". Artifacts
  are now addressed by the producing action's instance `id` instead.

  - Templates reference a produced artifact solely as
    `{{ artifacts.<actionId>.<localArtifactName>.<field> }}`, e.g.
    `{{ artifacts.open_jira.issue.issueKey }}`. The local artifact name is the
    producing action's `produces` id with the owning plugin prefix stripped
    (`integration-jira.issue` -> `issue`).
  - `@checkstack/automation-backend`: the dispatch engine nests each produced
    artifact under `artifacts[actionId][localName]` in the template scope and
    records the `actionId` on the artifact row. `validate-definition` now
    enforces that action ids are unique within an automation and that every
    artifact-producing action carries an id.
  - `@checkstack/automation-common`: action `id` is constrained to an
    identifier (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`) so it is always usable as a
    plain template segment. The variable-scope resolver surfaces
    `artifacts.<id>.<name>` (with full field completion) in the editor.
  - `@checkstack/automation-frontend`: the action editor now has editable `Id`
    and `Description` inputs (previously settable only via the YAML view), and
    new steps get an auto-assigned, unique, log-friendly default id that the
    operator can rename. Action ids are recorded on every run step, so run
    logs are parseable by id regardless of kind.

  **BREAKING (beta):** the previous flat, type-keyed scope form
  `{{ artifacts["integration-jira.issue"] }}` is removed. Reference artifacts
  by the producing action's id instead. Action ids may no longer contain
  hyphens or dots (identifier characters only). Artifacts are per-run and
  ephemeral, so no stored-data migration is needed.

- 41c77f4: feat(automation): native per-editor context for script actions (typed `context` for TS, `$ENV` for shell)

  Script action editors had a confusing dual system: the TypeScript editor
  type-checked `{{ }}` template text as code (so `{{ artifact.x }}` errored
  with "Cannot find name"), and the runtime never actually populated the
  `context` object. This standardises on a single, native context-access
  mechanism per editor kind.

  **Run scope reaches actions.** `ActionExecutionContext` gains a `scope`
  (`{ trigger, artifacts, vars, repeat? }`), populated by the dispatch
  engine from the same scope it already uses for `{{ }}` rendering. Actions
  that need broad context (the script actions) read from it instead of
  having to declare every artifact type in `consumes`. Additive and
  optional, so existing actions are unaffected.

  **TypeScript / JavaScript → typed `context`.** `run_script` now builds
  `context` from the run scope, so `context.trigger.payload`,
  `context.artifacts`, `context.var`, `context.repeat`, and
  `context.automation` are populated at run time (previously
  `context.trigger` was always empty). The editor types match via
  `generateAutomationContextTypes`.

  **Shell → `$CHECKSTACK_*` env vars.** `run_shell` flattens the run scope
  into environment variables (e.g. `$CHECKSTACK_TRIGGER_PAYLOAD_TITLE`,
  `$CHECKSTACK_ARTIFACT_INTEGRATION_JIRA_ISSUE_ISSUEKEY`). Arrays become a
  single newline-separated var (iterate with `while IFS= read -r x; do …;
done <<< "$VAR"`). Every value is a plain string — no JSON blob, since
  the container has no `jq` to parse one. A shared `toShellEnvKey`
  helper (in `@checkstack/automation-common`) derives the names so the
  shell editor's `$` autocomplete lists exactly what the runtime injects.

  **One syntax per field kind (editor + runtime).** `MultiTypeEditorField`
  no longer offers `{{ }}` autocomplete in `typescript` / `javascript` /
  `shell` editors, and the dispatch engine no longer template-renders
  native-code config fields (those whose `x-editor-types` is a code type) —
  so `{{ }}` can't be used in a script by accident. Text / markup editors
  (`raw`, `json`, `yaml`, `xml`, `markdown`, `formdata`) and plain string
  fields keep `{{ }}` as before. Because both the automation and
  health-check editors share `MultiTypeEditorField`, they behave
  identically.

  **Script-editor IntelliSense polish.** The code editors got a few
  ergonomic fixes so the typed context is actually usable: the suggestion
  **details panel auto-opens** (so long completion names are legible
  on-focus, not hidden behind the chevron); word-based keyword noise is
  disabled in favour of language-service + provider completions; and a
  TS/JS completion provider makes `context.artifacts.` list the in-scope
  artifact ids and **auto-convert the dot to bracket notation** —
  `context.artifacts["integration-jira.issue"]` — since those ids aren't
  valid identifiers. (Driven by a new opt-in `dottedKeyCompletions` prop on
  the editor / `DynamicForm`.)

  **BREAKING (beta):** `{{ }}` interpolation inside a script action's
  `script` field (shell or TypeScript) is no longer expanded at run time —
  read run data via the typed `context` object (TS) or `$CHECKSTACK_*` env
  vars (shell) instead. Non-script config fields are unchanged.

  Also fixes: switching a provider action in the visual editor now resets
  its config, so the validator no longer reports the previous action's keys
  as unrecognised.

- 41c77f4: feat(automation): Phase 10 — built-in triggers + actions

  Ships the core automation catalog every install has out of the box:

  **Triggers** (setup-backed via the shared
  `automation-builtin-triggers` queue):

  - `automation.cron` — recurring queue job on a cron pattern. Config:
    `{ cronPattern }`. Payload: `{ firedAt }`.
  - `automation.interval` — recurring queue job on a fixed interval.
    Config: `{ intervalSeconds }`. `startDelay = intervalSeconds` so an
    operator doesn't see a tick the instant they save the automation.
  - `automation.template` — polls a boolean template at `intervalSeconds`
    cadence and fires on the false → true edge. Uses
    `template-engine.evaluateBoolean` with `{ now }` in scope; invalid
    templates throw at setup so the operator sees the error in the
    editor rather than as silently-never-firing.

  All three share a single consumer + module-scoped `tickHandlers` map
  keyed by jobId. Restart semantics work the same way regardless of the
  queue backend: `setupTriggerSubscriptions` re-runs every enabled
  automation's `setup()` in `afterPluginsReady` on every boot, and
  `setup()` calls `scheduleRecurring(...)` with a deterministic jobId.
  On a persistent queue (BullMQ/Redis), the second call is an in-place
  update of the surviving recurring job. On the in-memory queue — whose
  recurring-schedule map is wiped at shutdown — it re-creates the
  schedule from scratch. Either way the schedule is back in place
  before the consumer would dispatch.

  **Actions**:

  - `automation.log` — write a single line to the run logger at the
    requested level (debug/info/warn/error). No artifact, no external
    delivery — the cheapest "I want to see something happened here"
    primitive, useful inside `choose` / `parallel` branches as a no-op
    placeholder until the operator wires the real action.
  - `automation.notify_user` — thin wrapper over
    `NotificationApi.sendTransactional` so the core install has a
    "notify a user" action without depending on the integration-
    notification plugin. Produces `automation.notify_user_result`
    (per-strategy outcome).

  The built-in catalog is registered directly via the trigger/action
  registries in `init()` — no extension-point round-trip needed, since
  automation-backend owns the registry. Pulls in
  `@checkstack/notification-common` as a runtime dep for the
  service-mode RPC call.

- 41c77f4: feat(automation): backend RPC router with the full 15-endpoint contract

  Wires up `core/automation-backend/src/router.ts` covering automation CRUD,
  definition validation, manual runs, run history, registry introspection,
  and a template playground. The contract is refactored to use the
  project's `proc()` pattern so `autoAuthMiddleware` enforces `read` /
  `manage` access automatically, and `AutomationApi` is exported via
  `createClientDefinition` for the frontend client.

- 41c77f4: feat(automation): one-time migration of webhook subscriptions + remove legacy integration backend

  **BREAKING CHANGES** (platform is in BETA — no major bump):

  - `IntegrationProvider` no longer carries `config` (subscription
    config) or `deliver`. The interface now models a connection provider
    only: connection schema + `getConnectionOptions` + `testConnection`.
  - The legacy subscription / delivery-log / event endpoints
    (`listSubscriptions`, `createSubscription`, `getDeliveryLogs`,
    `listEventTypes`, …) are removed from `integrationContract`.
  - `delivery-coordinator`, `hook-subscriber`, `event-registry`, and the
    `integrationEventExtensionPoint` are deleted. Plugins that
    previously called `integrationEvents.registerEvent(...)` now
    register their hooks as automation triggers via
    `automationTriggerExtensionPoint.registerTrigger(...)`.
  - Frontend pages `IntegrationsPage` and `DeliveryLogsPage` are gone;
    the integration plugin's only remaining UI is connection
    management. Subscription management lives under `/automation/...`.
  - `webhook_subscriptions` and `delivery_logs` tables stay in the
    database for one release as a safety net (no code reads or writes
    them), and will be dropped in a follow-up migration.

  **New**:

  - `jira.create_issue`, `teams.post_message`, `webex.post_message`,
    `webhook.send`, `integration-script.run_shell`, and
    `integration-script.run_script` actions registered against the
    Automation Platform with matching `*.message`, `*.delivery`,
    `shell.result`, and `script.result` artifact types. The script
    plugin exposes **two** actions — `run_shell` runs bash via the
    shared `ShellScriptRunner` (Monaco `shell` editor), `run_script`
    runs an ESM module in a Bun subprocess via `EsmScriptRunner`
    (Monaco `typescript` editor + `defineIntegration` helper) — to
    preserve the legacy provider split. `jira.create_issue` keeps the
    dynamic field-mapping dropdown (driven by
    `JIRA_RESOLVERS.FIELD_OPTIONS`).
  - One-time data migration runs on boot in
    `automation-backend.afterPluginsReady`. It reads
    `webhook_subscriptions` via a new service RPC
    `IntegrationApi.listLegacySubscriptions`, translates each row into
    a single-trigger / single-action automation (marked with
    `managed_by = "migrated-subscription:<id>"`), and is idempotent
    across restarts.
  - Failed translations are recorded in a new
    `automation_migration_failures` table and surfaced via
    `AutomationApi.listMigrationFailures` /
    `acknowledgeMigrationFailure` so admins can review and re-create
    failed entries by hand.

- 41c77f4: fix(automation): qualify action `produces` / `consumes` with the owning plugin id

  `context.artifacts` showed up untyped (no fields) in the script editor
  because action `produces` / `consumes` were hand-written full strings
  (`"jira.issue"`) that did not match the artifact-type registry's
  qualified id. The registry derives `${pluginId}.${id}`, and the plugin's
  id is the package name `integration-jira`, so the artifact type actually
  registers as `integration-jira.issue` — the editor's schema lookup
  (`produces` vs registered `qualifiedId`) missed, leaving the artifact's
  fields unknown. (Runtime store/consume happened to agree with each other
  on the short string, so it "worked" but typed nothing.)

  The action registry now qualifies `produces` with the owning plugin id,
  exactly as it already qualifies the action's own `id` and as the
  artifact-type registry qualifies the artifact type id — so the three can
  never drift. Actions declare the **local** artifact id:

  - `produces: "issue"` → registered as `integration-jira.issue`,
  - `consumes: ["issue"]` → resolved against the owning plugin's namespace
    at run time; `consumedArtifacts` is keyed by the local id, so an
    action's `execute` reads `consumedArtifacts["issue"]`.

  All five artifact-producing integration plugins (jira / teams / webex /
  webhook / script) now declare local ids. With `produces` matching the
  registered artifact type, the editor types `context.artifacts[...]` with
  the real schema (e.g. `issueKey`, `projectKey`, `issueUrl`).

  **BREAKING (beta):** the fully-qualified artifact type ids change from
  the short form to the plugin-prefixed form, e.g. `jira.issue` →
  `integration-jira.issue`. This affects how artifacts are referenced in
  templates (`{{ artifact.integration-jira.issue.issueKey }}`), the TS
  script `context.artifacts["integration-jira.issue"]`, and shell env names
  (`$CHECKSTACK_ARTIFACT_INTEGRATION_JIRA_ISSUE_ISSUEKEY`). Artifacts are
  per-run and ephemeral, so no stored-data migration is needed.

  Note: this keeps the same-plugin produce→consume handoff (the current
  pattern). Cross-plugin artifact consumption would need a follow-up to
  allow a fully-qualified `consumes` ref.

- 6d52276: feat(automation): expose `trigger.actor` so automations can filter on who/what caused an event

  Every platform event now carries an **actor** - the user, application (API
  client), service (backend-to-backend), or `system` (background /
  unauthenticated) that caused it - and the automation engine surfaces it to
  automations as `trigger.actor`. This lets a trigger filter gate on the
  origin of the event it reacts to:

  ```text
  {{ trigger.actor.type == "system" }}      # auto-created by the platform
  {{ trigger.actor.type == "user" }}         # a human
  {{ trigger.actor.id == "app-deploybot" }}  # a specific application
  ```

  `trigger.actor` is available on **every** trigger - it is injected by the
  platform, not declared per trigger - and editor autocomplete + Run Script
  context types include `trigger.actor.{type,id,name}`.

  How it works:

  - **`@checkstack/common`** adds the canonical `Actor` type / `ActorSchema`
    and `SYSTEM_ACTOR`.
  - **`@checkstack/backend-api`** adds `resolveActor(user)` and a
    `HookEventMeta` envelope. The hook listener / `onHook` signature gains an
    optional second `meta` argument (additive, backward compatible).
  - **`@checkstack/backend`** wraps emitted hooks in an envelope so the actor
    travels with the payload through the distributed queue, unwrapping it
    before delivery. The RPC emit path captures the authenticated caller;
    background emits default to the system actor. Raw/legacy queue data is
    treated as a system-actor payload, so delivery stays backward compatible.
  - **`@checkstack/automation-backend`** threads the actor into the dispatch
    scope (`trigger.actor`), available to trigger filters, top-level
    conditions, and all run templates, and persisted in the run's scope
    snapshot. Manual runs are attributed to the invoking user.
  - **`@checkstack/automation-common`** / **`@checkstack/automation-frontend`**
    expose `trigger.actor` in the editor variable scope and the generated
    Run Script `context.trigger.actor` types.

  No database migration and no per-trigger schema changes: the actor rides as
  event-envelope metadata and in the run scope snapshot.

- 6d52276: feat(automation): expose `trigger.id` and reconcile the trigger scope so multiple triggers are distinguishable

  Automations with more than one trigger could not tell which trigger fired:
  the trigger id wasn't queryable, and scripts only received `trigger.event`
  (so two triggers on the same event were indistinguishable). This exposes a
  consistent trigger contract everywhere - `trigger.id`, `trigger.event`,
  `trigger.actor`, `trigger.payload` - in templates, shell, and TypeScript
  scripts.

  - **`trigger.id` is now available** in templates (`{{ trigger.id }}`) and in
    the script context (`context.trigger.id`). It is typed as the **literal
    union** of the automation's trigger ids, so it discriminates triggers -
    including two subscribed to the same `event`.
  - **Auto-generated trigger ids.** The editor now assigns a unique, log-
    friendly id to every trigger (derived from its event, e.g.
    `incident_created`, deduped as `incident_created_2`), mirroring action ids:
    seeded on the starter automation, assigned on add, and re-filled on blur.
  - **Scripts now receive `trigger.id` and `trigger.actor`.** The
    `ActionRunScope` projection previously dropped both (it only forwarded
    `event` + `payload`), so `context.trigger.actor` was typed but never
    populated - that gap is fixed.
  - **Scope key reconciled.** The internal dispatch scope now exposes
    `trigger.event` as the canonical key (matching the editor and script
    contract) instead of leaking `trigger.eventId`; `trigger.eventId` is kept
    as a back-compat alias, so `{{ trigger.event }}` now resolves in template
    fields where it previously returned `undefined`.

  No database migration: the actor and id ride in the run scope snapshot. A
  shared `deriveTriggerId` is exported from `@checkstack/automation-common` so
  the editor, generated script types, and the runtime all agree on derived ids.

### Patch Changes

- Updated dependencies [e2d6f25]
- Updated dependencies [e1a2077]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [4832e33]
- Updated dependencies [6d52276]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
  - @checkstack/automation-common@0.2.0
  - @checkstack/template-engine@0.2.0
  - @checkstack/integration-common@0.6.0
  - @checkstack/common@0.12.0
  - @checkstack/backend-api@0.18.0
  - @checkstack/command-backend@0.1.31
  - @checkstack/notification-common@1.2.1
  - @checkstack/signal-common@0.2.5
  - @checkstack/queue-api@0.3.6
