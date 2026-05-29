---
"@checkstack/automation-frontend": minor
---

feat(automation): Phase 12 — frontend plugin (Visual + YAML)

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
  + duration), a destructive Alert with `errorMessage` when the run
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
