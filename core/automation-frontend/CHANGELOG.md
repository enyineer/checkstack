# @checkstack/automation-frontend

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

- 41c77f4: fix(automation): editor UI fixes — action-config autocomplete, popup edge clamping + scroll, de-misleading action icon

  Four fixes to the automation editor's visual mode:

  - **Template autocomplete on action config fields.** A provider
    action's config form (e.g. `automation.log`'s `message`) rendered
    plain string fields with no `{{ … }}` autocomplete — only the
    condition/expression fields had it. `DynamicForm` gains a
    `templateCompletionProvider` prop; when supplied, default single-line
    string fields render a `TemplateValueInput` wired to it instead of a
    bare `Input`. The automation editor passes the staged template-mode
    provider, so config fields now get the same field / comparator / value
    / filter completion as conditions. Other `DynamicForm` consumers are
    unaffected (the prop is opt-in; without it string fields stay plain).

  - **Autocomplete popup no longer overflows the window.** The popup is
    now edge-aware: it flips above the input when there isn't room below,
    anchors to the input's right edge when a left-anchored popup would
    spill past the right edge, and caps its height to the available space
    (the list scrolls within it). The placement decision is extracted into
    a pure, unit-tested `computePopupPlacement` helper.

  - **Keyboard navigation scrolls the popup.** Arrowing through a list
    taller than the popup now scrolls the highlighted row into view
    (`scrollIntoView({ block: "nearest" })`) instead of leaving the
    selection off-screen.

  - **Action card icon no longer looks like a run button.** The "action"
    kind used a `Play` triangle, which reads as a test/run control but
    actually sits inside the card's expand toggle (so clicking it just
    collapsed the card). Swapped to `Zap`, the conventional
    automation-action glyph, which carries no "click to run" affordance.

  - **Inline-script actions get their typed runtime context.** The Monaco
    editor for `Run Script (TypeScript)` was falling back to an untyped
    default context because the editor never received type definitions.
    `useVariableScope` now also returns the `declare const context: …`
    declarations from `generateAutomationContextTypes` (already built, but
    never wired), and the provider action body forwards them to
    `DynamicForm` so `context.trigger.payload` is typed as the discriminated
    union over the automation's subscribed triggers, with
    `context.artifacts` / `context.var` / `context.repeat` in scope at the
    action's position. Shell scripts get their context the same way every
    other config string does: `{{ … }}` templates are expanded by the
    dispatch engine (`renderValue`) before the script runs, with the same
    field autocomplete as other template fields.

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

- 41c77f4: feat(automation): Phase 11 — editor primitives + context type generation

  Lays the UI + type-generation groundwork for Phase 12's visual automation
  editor. Every primitive reuses the existing Monaco wrapper / template
  engine / `jsonSchemaToTypeScript` helper rather than building parallel
  infrastructure.

  **`@checkstack/automation-common` — `resolveVariableScope`**

  Pure walker that returns the in-scope `{{ … }}` paths at a given action
  position. Conservative scoping rules: linear-upstream variables /
  artifacts only (no leaking across `choose` / `parallel` / `repeat`
  branches), `repeat.index` / `repeat.item` exposed only inside a `repeat`,
  and trigger.payload modelled as a **discriminated union over
  `trigger.event`** — every payload field surfaces; ones that come from a
  subset of subscribed triggers carry a `conditionalOnTriggers` annotation
  so the picker can render an "Only when …" hint. Earlier draft used
  schema-intersection; switched to discriminated unions per review
  feedback so Monaco can narrow correctly inside event-gated branches.

  **Condition-aware narrowing.** When the path descends through a
  `choose-when`, the resolver parses the branch's `when:` expression and
  statically pins `trigger.event` to the set the condition allows —
  patterns covered are `trigger.event == "X"` (either operand order),
  `trigger.event != "X"`, `||`/`&&` of those, and `{ and: [...] }` /
  `{ or: [...] }` combinators. So an action inside
  `when: 'trigger.event == "incident.created"'` sees only the
  `incident.created` variant in scope, the `conditionalOnTriggers`
  annotation disappears, and other-trigger fields drop out entirely.
  Nested choose branches compound (intersection). Anything outside the
  covered patterns falls back to the full union — better to show every
  field than guess wrong.

  **`@checkstack/template-engine`**

  The expression AST (`Expr`, `BinaryExpr`, `MemberExpr`, etc.) is now a
  public export — the resolver's condition-narrowing walker needs to
  inspect parsed condition trees. `ParsedCondition.root` is tightened
  from `unknown` to `Expr` so consumers don't need to cast.

  **`@checkstack/automation-frontend` — `generateAutomationContextTypes`**

  Consumes `resolveVariableScope`'s output + the trigger / artifact
  registries and emits the `declare const context: { … }` TS declaration
  that `integration-script.run_script`'s Monaco editor injects via
  `addExtraLib`. The emitted shape:

  ```ts
  type AutomationTrigger =
    | { event: "incident.created"; payload: { … } }
    | { event: "incident.resolved"; payload: { … } };

  declare const context: {
    trigger: AutomationTrigger;
    artifacts: { "jira.issue"?: { key: string; … }; … };
    var: { foo?: string; … };
    repeat: { index: number; item: unknown };  // only when inside a repeat
  };
  ```

  `jsonSchemaToTypeScript` from `@checkstack/ui` is reused via a deep
  import (rather than the barrel) so the bun test runner doesn't try to
  load Monaco's Vite-only `?worker` modules during unit tests.

  **`@checkstack/ui` — new editor primitives**

  - `TemplateValueInput` — single-line `{{ }}` autocomplete input.
    Extracted from `DynamicForm/KeyValueEditor`'s previously-private
    `TemplateInput` so other editor surfaces can share it without
    rebuilding the picker UX. `KeyValueEditor` is now a one-line
    delegation; `detectTemplateContext` is also exported.
  - `VariablePicker` — hierarchical popover for the explicit "fx" /
    "Insert variable" workflow. Renders a filterable tree of
    `VariableNode`s with type chips and `Only when …` hints sourced from
    the resolver's `conditionalOnTriggers`. Defaults to a small "fx" pill
    trigger; callers can pass a custom one.
  - `TemplateInput` — high-level mode switcher: `text` mode delegates to
    `TemplateValueInput`, all other modes (`code` / `bash` / `json` /
    `yaml`) delegate to `CodeEditor` with the matching language so the
    action editor can swap widgets purely from the action's
    `x-editor-types` annotation without touching the consuming code.
  - `TemplateInputToggle` — the small "fx" pill that flips a typed input
    (number / select / date / …) into template mode and back. Auto-infers
    template mode when the saved value already starts with `{{`, so
    round-tripping a previously-templated automation works out of the
    box. Render-prop API for the typed editor so consumers keep control
    over their own input shape.
  - `ActionCard` — collapsible card that hosts a single action in the
    visual editor. Decoupled from `DynamicForm` so container blocks
    (`ChooseBlock` / `ParallelBlock` / `RepeatBlock` in Phase 12) can use
    it as a structural shell over their own children. Toggle / delete /
    drag handle are conditionally rendered on their callback's presence.

  Storybook stories shipped for each of the new primitives.

  **`@checkstack/integration-script-backend`**

  `ScriptContext` docstring and the `scriptRunConfigSchema.script` field
  description now point at `generateAutomationContextTypes` so the Phase
  12 editor wiring is unambiguous — the runtime payload type stays
  `Record<string, unknown>` (the runner can't know the trigger schema),
  but the **editor** narrows it per-automation from the subscribed
  triggers' payload schemas.

- 41c77f4: feat(automation): Phase 12 — frontend plugin (Visual + YAML)

  Ships the complete operator-facing surface for the automation platform:

  **Pages**

  - `AutomationListPage` — paginated table of every automation. Inline
    enable / disable toggle, status filter, "Runs" deep-link per row,
    trash-button delete with a confirmation modal. Rows themselves
    navigate to the edit page on click; toggle / delete cells
    `stopPropagation` to avoid the navigation.
  - `AutomationEditPage` — **Visual ↔ YAML** tab switcher; both tabs
    read/write the same canonical `definition` state, switching tabs
    first commits the active tab's edits (parsing YAML on YAML→Visual)
    so neither side ever wins by accident. Top-level metadata form
    (name, description, status toggle, mode, max_runs) sits in a side
    column. Save flow: commit active tab → `validateDefinition` RPC →
    `createAutomation` / `updateAutomation`. Parse + validation errors
    render as a destructive Alert. The "Run now" action fires
    `manualRun` with the first declared trigger and navigates to the
    resulting run detail.

    **Visual tab** ships the full editor. `AutomationDefinitionEditor`
    composes three sections — triggers, pre-run conditions, actions —
    using the Phase 11 UI primitives (`ActionCard`,
    `TemplateValueInput`, `VariablePicker`) plus a new `editor/`
    module:

    - `TriggersEditor` — per-trigger card with combobox event picker
      (`ItemPicker`), optional `id` and `filter`, and a `DynamicForm`
      for trigger config when the selected trigger declares a
      `configSchema`.
    - `ConditionsEditor` + recursive `ConditionEditor` — top-level
      pre-run gating and the same recursive editor reused inside
      `choose: when` clauses. Each level picks `expression` /
      `and` / `or` / `not`; `and` / `or` host child conditions with
      add/remove buttons; expression mode uses `TemplateValueInput`
      with inline `VariablePicker`.
    - `ActionListEditor` — drag-to-reorder via `@dnd-kit/core` +
      `@dnd-kit/sortable`. Maintains a parallel stable-id array so
      in-place edits don't churn React keys but reorders do. Add-step
      popover offers all 10 action kinds with their icons.
    - `ActionEditor` — dispatch component that picks the right
      per-kind body and wraps it in a shared `ActionCard` (icon,
      title, category badge, enable toggle, delete, drag handle).
      Header exposes a kind-swap `<Select>` that preserves
      operator-set metadata (id, description, enabled,
      continue_on_error).
    - Per-kind bodies covering every primitive — Provider (with
      `DynamicForm` over the action's `configJsonSchema`), Variables
      (KeyValueEditor with JSON-or-template parsing), Stop, Delay
      (seconds vs template toggle), WaitForTrigger (event picker +
      filter + timeout + context_key), ConditionGuard (reuses
      `ConditionEditor`), Choose (recursive when-branches + optional
      else), Parallel, Sequence, Repeat (count / for_each / while /
      until + nested sequence + max_iterations safety net).
    - **Scope-aware autocomplete.** A
      `useVariableScope({ definition, path })` hook drives template
      properties for every field — each action card knows its
      `ActionPath`, so the `{{` autocomplete + `VariablePicker` only
      ever offers paths actually in scope at that position,
      including condition-narrowed `trigger.payload.*` inside `when:`
      branches. Reuses Phase 11's `resolveVariableScope`.

    **YAML tab** — Monaco `yaml` editor round-tripping the full schema
    via `yaml.parse` / `yaml.stringify`.

  - `RunsPage` — run history for a single automation. Status filter
    buttons across the canonical `RunStatus` enum
    (`pending|running|waiting|success|failed|cancelled|skipped`), rows
    link to the run detail.
  - `RunDetailPage` — single run drill-down. Shows the run header (status
    - duration), a destructive Alert with `errorMessage` when the run
      failed, a per-step timeline with status icon + attempts + inline
      error message + collapsible result payload, the trigger payload as
      read-only JSON in Monaco, and an artifacts panel listing every
      produced artifact keyed by `artifactType`. Cancel-run button when the
      run is `running` or `waiting`.
  - `TemplatePlaygroundPage` — left/right editors for template body and
    sample JSON context, mode switcher between `template` and
    `condition`, "Render" button that calls `renderTemplate` RPC and
    shows either the rendered string (template mode) or the boolean
    result (condition mode). Parse errors come back with line/column
    info shown alongside the error message — Monaco inline markers come
    in a later polish pass.

  **Plugin entry + slot extensions**

  - `createFrontendPlugin({...})` wires every route, all access-gated
    through `automationAccess.read` and `automationAccess.manage`:
    - `/automation/` → list (read)
    - `/automation/new` → blank edit page (manage)
    - `/automation/:automationId` → edit (read, save gated on manage)
    - `/automation/:automationId/runs` → run history (read)
    - `/automation/:automationId/runs/:runId` → run drill-down (read)
    - `/automation/playground` → playground (read)
  - `AutomationMenuItems` slot extension on `UserMenuItemsSlot` adds an
    "Automations" entry to the user menu for any user with
    `automation.read`. Mirrors `incident-frontend`'s pattern of hiding
    the menu link from unauthorised users even though the route itself
    is also access-gated.
  - No `foreignSignals` declared: every signal the automation domain
    emits (`AUTOMATION_DEFINITION_CHANGED`, `AUTOMATION_RUN_*`) is owned
    by this plugin, so the auto-invalidator wires it for free.

  **Reused components, no duplication**

  Every page is built from `@checkstack/ui` primitives: `PageLayout`,
  `Card`, `Table`, `Badge`, `Toggle`, `Button`, `Select`,
  `LoadingSpinner`, `QueryErrorState`, `EmptyState`,
  `ConfirmationModal`, `Alert`, `CodeEditor`, `Tabs`, `DynamicForm`,
  `KeyValueEditor`, `Popover`, `ActionCard`, `TemplateValueInput`,
  `VariablePicker`. The visual editor's only new components are the
  ones the existing UI library deliberately doesn't ship (combobox
  `ItemPicker`, plus the automation-domain editors themselves) —
  everything else is composition.

  **New deps**: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
  (drag-to-reorder), already in the monorepo via `catalog-frontend`'s
  core/utilities usage; we add `sortable` because the action list needs
  the higher-level sortable abstraction.

- 4832e33: fix(automation): insert runtime-parseable `templateRef` from editor autocomplete + variable picker, with array indexing

  The automation editor's `{{ }}` autocomplete and the `fx` variable picker
  previously inserted the canonical dotted path (e.g.
  `artifact.integration-jira.issue.issueKey`), which the template engine
  cannot parse when an artifact id contains dots or hyphens, and which used
  the singular `artifact`/`var` namespaces the runtime template context does
  not expose. They now insert the runtime-parseable `templateRef` form -
  plural top-level namespace (`artifacts`/`variables`) plus bracket notation
  for non-identifier segments, e.g. `artifacts["integration-jira.issue"].issueKey`.

  - `@checkstack/automation-common`: `VariableEntry` gains `templateRef`
    (runtime-parseable insertion form) and `referenceable`, alongside the
    unchanged canonical `path`. New exported helpers `isTemplateIdentifier`,
    `appendTemplateSegment`, and `appendArrayIndex` build the form. Scope
    derivation now descends into `array` schemas, offering both the whole
    array and a representative element subtree (`tags[0]`, `comments[0].author`,
    nested `matrix[0][0]`).
  - `CompletionField` / `TemplateProperty` / `VariableNode` carry a
    `templateRef` alongside the canonical `path`.
  - The staged completion provider's field label, filter/match, insert text,
    and value-stage field lookup all operate in `templateRef` space. The
    expression tokenizer now emits bracket tokens and reconstructs the full
    `foo["bar"].baz` / `foo["bar"].list[0]` access chain (normalising single
    quotes to the stored double-quoted form, and supporting bare numeric array
    indices) so value-stage enum suggestions resolve for bracket-notation and
    indexed fields.
  - `VariablePicker` and the `DynamicForm` template inserters write the
    `templateRef` (falling back to `path` when absent).
  - Shell-env (`$CHECKSTACK_*`) name derivation deliberately keeps using the
    canonical dotted `path`, so the suggested env names stay byte-identical
    to the backend's path-based injection. Script-context type generation is
    unchanged.
  - `@checkstack/integration-script-backend`: shell-script actions now also
    expose array elements as indexed `$CHECKSTACK_*_<i>` env vars (and
    `$CHECKSTACK_*_<i>_<field>` for object elements), alongside the existing
    whole-array newline-joined var, so the runtime injects exactly the
    array-element names the editor now suggests.

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

- 35bc682: feat(healthcheck): expose check + system run-context to script collectors

  Script health checks can now read which check and system a run is for.
  Previously shell scripts got only a curated env whitelist and inline
  scripts only `context.config`, so a script had no built-in way to know
  its own check name or the system it was checking.

  - `@checkstack/backend-api`: new `CollectorRunContext` type
    (`{ check: { id, name, intervalSeconds }, system: { id, name } }`) and
    an optional `runContext` param on `CollectorStrategy.execute`. Optional,
    so existing collector implementations are unaffected.
  - Shell-script collector: injects reserved `CHECKSTACK_CHECK_ID`,
    `CHECKSTACK_CHECK_NAME`, `CHECKSTACK_CHECK_INTERVAL_SECONDS`,
    `CHECKSTACK_SYSTEM_ID`, `CHECKSTACK_SYSTEM_NAME` env vars (user-supplied
    `env` still wins on collision).
  - Inline-script collector: exposes `context.check` and `context.system`
    alongside `context.config`; the inline-script editor now types them for
    autocomplete.
  - Shell editors (health-check collectors and automation shell actions) now
    also suggest the user's own `env` (JSON) keys as `$NAME` completions, via
    the new exported `customShellEnvVars` helper. Keys that aren't valid shell
    identifiers are omitted.
  - Fix: the Typefox `CodeEditor` captured a stale `onChange` at editor start,
    so editing one `DynamicForm` field reverted sibling fields changed since
    mount (e.g. typing in a shell `script` field wiped an unsaved `env` value,
    or deleted a sibling automation action added after mount). The change
    handler now routes through a ref to the current `onChange`.
  - Fix: focusing a JSON editor threw "LanguageStatusService.addStatus is not
    supported" because the standalone service set omitted `ILanguageStatusService`.
    That one service is now registered via `serviceOverrides`.
  - Fix: the automation trigger card nested a `<Badge>` (a `<div>`) inside a
    `<p>`, producing a `validateDOMNesting` warning. Switched the wrapper to a
    `<div>`.
  - Local runs (`queue-executor`) and satellite runs both populate the
    context. `SatelliteAssignment` (and the `getAssignmentsForSatellite`
    RPC output) gained optional `configName` / `systemName` so the metadata
    reaches satellite-side execution; `HealthCheckService` resolves the
    system name via the catalog client.

  BREAKING CHANGE: `createHealthCheckRouter` now requires a `catalogClient`
  option (used to resolve system names for satellite assignments). Update
  call sites to pass the catalog RPC client.

### Patch Changes

- Updated dependencies [e2d6f25]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [e1a2077]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [41c77f4]
- Updated dependencies [4832e33]
- Updated dependencies [6d52276]
- Updated dependencies [6d52276]
- Updated dependencies [35bc682]
- Updated dependencies [c39ee69]
  - @checkstack/automation-common@0.2.0
  - @checkstack/frontend-api@0.6.0
  - @checkstack/ui@1.11.0
  - @checkstack/template-engine@0.2.0
  - @checkstack/integration-common@0.6.0
  - @checkstack/common@0.12.0
  - @checkstack/signal-frontend@0.1.5
