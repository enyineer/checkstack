# Plan: fix automation `{{ }}` template resolution for artifacts

Status: **proposed / not started.** Discovered 2026-05-30 while end-to-end
testing the Monaco→Typefox editor migration. **Unrelated to that migration** —
this is a pre-existing bug in the automation template layer.

## Symptom

The visual editor's `{{` autocomplete suggests artifact references like:

```
{{artifact.integration-jira.issue.issueKey}}
```

This **does not resolve at run time**. It either throws a parse error or
silently renders to an empty string.

## Two independent defects

### Defect A — dotted / hyphenated artifact ids can't be parsed

The runtime renders `{{ }}` via the real lexer/parser in
`@checkstack/template-engine` (NOT a `string.split(".")`):

- `core/automation-backend/src/dispatch/render.ts` → `renderTemplate(parseTemplate(t), ctx, …)`
- `core/template-engine/src/parser.ts` (`parsePostfix`): each `.` requires a
  single `IDENT`; `[ … ]` reads a full sub-expression (index access).
- `core/template-engine/src/tokenizer.ts`: identifier chars are letters /
  digits / `_` / `$` only — **no hyphen**. A `-` is not an operator either, so
  the tokenizer throws `Unexpected character "-"`.

So `artifact.integration-jira.issue.issueKey`:
1. throws on the `-` in `integration-jira`; and
2. even hyphen-free, `integration-jira.issue` would be split into separate
   member hops (`… → integration → issue → …`), never matching the dotted
   artifact key.

The only runtime-parseable form is **bracket notation** for the dotted key:
`artifacts["integration-jira.issue"].issueKey`.

### Defect B — namespace name mismatch (singular vs plural)

The editor scope/autocomplete uses **singular** top-level names, but the
runtime `{{ }}` context object uses **plural**:

- Autocomplete paths built as `artifact.${produces}` / `var.…`:
  `core/automation-common/src/variable-scope.ts` (`accumulatePrefix`,
  `entriesFromSchema`), surfaced by
  `core/automation-frontend/src/editor/template-helpers.ts` (`flattenScopeToFields`).
- Runtime `{{ }}` context = the raw scope, keyed `artifacts` / `variables`:
  `core/automation-backend/src/dispatch/scope.ts` (`buildInitialScope`),
  written at `core/automation-backend/src/dispatch/engine.ts` (`[produces]`
  under `artifacts`), returned verbatim as the template context in
  `engine.ts` (`return ctx.scope`).
- The `artifact`→`artifacts` / `var`→`vars` normalization in
  `actionRunScope` applies ONLY to the typed `context` handed to **code**
  actions, NOT to the `{{ }}` template context.

So even a simple dot-free `{{artifact.foo.bar}}` resolves to `undefined` →
renders empty (silent, because the renderer is `strict: false`).

> NOTE: the typed `context` for **TypeScript/JavaScript script actions** is a
> separate path (`actionRunScope`) and is NOT affected by Defect B; the editor
> migration's `context.artifacts["…"]` completion targets that typed context,
> which is correct. This plan is specifically about the `{{ }}` *template*
> string resolution used by non-script fields (XML/JSON/YAML bodies, etc.).

## Fix approach (small, focused — separate PR from the editor migration)

1. **Reconcile namespaces (Defect B).** Decide the single source of truth and
   make editor paths match the runtime context keys (or normalize the template
   context to accept both). Prefer: emit the runtime names (`artifacts`,
   `variables`) from the scope/flatten layer so autocomplete inserts what the
   engine reads. Audit every producer of these path strings.
2. **Emit bracket notation for non-identifier segments (Defect A).** Where a
   path segment is not a valid identifier (artifact ids with dots/hyphens),
   the generated template must use `["…"]` rather than `.…`. Update
   `flattenScopeToFields` / `variable-scope.ts` path construction so the
   inserted text is e.g. `{{ artifacts["integration-jira.issue"].issueKey }}`.
   Confirm the template parser's index-access path handles this (it does:
   `parser.ts` LBRACKET branch).
3. **Verify the parser** handles every generated form (bracket + dotted mix).
   If any generated segment can still contain hyphens outside brackets, fix at
   the source.

## Tests

- Unit: template-engine parses `artifacts["integration-jira.issue"].issueKey`
  and resolves it against a scope with that artifact (add to
  `core/template-engine` tests).
- Unit: the path generator (`variable-scope` / `flattenScopeToFields`) emits
  bracket notation for non-identifier artifact ids and the plural namespace.
- Regression: end-to-end render of a body template referencing a dotted
  artifact id returns the field value (not empty / not a parse error).

## Key files

- `core/automation-backend/src/dispatch/render.ts`
- `core/template-engine/src/{tokenizer,parser,renderer}.ts`
- `core/automation-backend/src/dispatch/{scope,engine}.ts`
- `core/automation-common/src/variable-scope.ts`
- `core/automation-frontend/src/editor/template-helpers.ts`
</content>
