---
"@checkstack/catalog-frontend": minor
"@checkstack/healthcheck-frontend": minor
---

Preview system custom fields in the health-check editor

The editor gained a **System** picker beside the existing "Preview as"
environment picker, so `{{ system.metadata.<key> }}` resolves in the preview line
and offers `{{ }}` autocomplete.

Previously system templating could only be previewed when the editor happened to
be opened FROM a system: a shared-config authoring flow and every edit-mode
session got no preview and no completions at all, because the systems list was
not even fetched in edit mode.

Selecting only a system is now enough to preview - an environment is no longer
required, since `system.metadata.*` is fully resolvable without one. Both pickers
only offer resources the caller may read.
