# @checkstack/template-engine

## 0.3.0

### Minor Changes

- 270ef29: Add live state in scope plus duration helpers to the automation sensing layer (Wave 2 Phase 14).

  - `@checkstack/template-engine` ships four pure, synchronous duration filters: `minutes` and `hours` (number to milliseconds), `duration_since` (ms elapsed since an ISO timestamp), and `older_than(thresholdMs)` (boolean dwell check). They compute against real time at call time, so "now" is fresh per evaluation. Fail-safe on null/unparseable input.
  - The dispatch engine pre-resolves live health state into scope before any condition or template evaluation (the engine is synchronous, so inline state queries are impossible). State is folded under a `health` namespace - `health.system.*` for the trigger's context system and `health.systems[<id>]` for ids listed in the automation's new `uses_state` field. One batched `getBulkHealthState` query per evaluation, wired at the fresh-run, resume, and trigger-gate sites. Fail-open: a missing client or provider error yields an empty namespace and a warning, never wedging unrelated automations.
  - New `automationFilterExtensionPoint` lets plugins contribute pure template filters without forking the engine's default registry. Name collisions with built-ins are skipped with a warning.
  - The editor variable-scope resolver and autocomplete catalogue now surface the `health.*` namespace and the new duration filters.

  With this phase alone, an operator can build "notify me when a system has been unhealthy for 30 minutes" using an interval trigger plus a single `health.*` condition - no dwell timer required (the precise event-driven path lands in Phase 15).

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [6d52276]
  - @checkstack/common@0.12.0
