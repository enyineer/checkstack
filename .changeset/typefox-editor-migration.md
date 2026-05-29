---
"@checkstack/ui": minor
---

Replace the Monaco-based `CodeEditor` with `@typefox/monaco-editor-react`, backed
by the standalone VS Code language services (no SharedArrayBuffer / cross-origin
isolation required). The `CodeEditor` public API is unchanged except for the
breaking note below; existing consumers keep working.

What this improves:

- Typed `context` IntelliSense is reliable (no more `addExtraLib` timing race).
- JSON / YAML / XML editors gain template-aware structural validation: the
  content is validated as the JSON/YAML/XML it renders to, so `{{ }}` templates
  are tolerated in any position (including unquoted, e.g. a numeric value) while
  genuine structural errors are still flagged.
- JSON uses the real VS Code JSON language service (proper highlighting +
  completion).
- Template `{{ }}` completion, shell `$env` completion, and external validation
  markers are preserved.

> [!IMPORTANT]
> BREAKING (beta): the `dottedKeyCompletions` prop is removed from `CodeEditor`
> (and from `DynamicForm` / `FormField`). Bracket-notation completions for
> non-identifier object keys (e.g. `context.artifacts["integration-jira.issue"]`)
> are now derived automatically from the injected `typeDefinitions`, so the prop
> is no longer needed.

The `monaco-editor` and `@monaco-editor/react` dependencies are removed.
