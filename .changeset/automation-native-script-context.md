---
"@checkstack/integration-script-backend": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
"@checkstack/automation-common": minor
"@checkstack/ui": minor
---

feat(automation): native per-editor context for script actions (typed `context` for TS, `$ENV` for shell)

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
