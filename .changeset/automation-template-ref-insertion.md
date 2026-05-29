---
"@checkstack/automation-common": minor
"@checkstack/automation-frontend": minor
"@checkstack/integration-script-backend": minor
"@checkstack/ui": minor
---

fix(automation): insert runtime-parseable `templateRef` from editor autocomplete + variable picker, with array indexing

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
