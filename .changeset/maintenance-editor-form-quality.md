---
"@checkstack/maintenance-frontend": minor
---

Upgrade the maintenance editor's form quality to match the catalog/incident
editors and the schema-driven DynamicForm pattern.

- Inline per-field validation: a per-field error map
  (`deriveMaintenanceFieldErrors`) is now the single source of truth for both
  the inline `FormError` messages and submit-validity. Errors reveal per field
  on blur/interaction (touched) or after a submit attempt, replacing the
  previous single generic toast. The existing end-after-start rule is preserved
  and now surfaces inline on the end-date field.
- The dialog body is wrapped in `<form onSubmit>` with a primary
  `type="submit"` button, so Enter submits and secondary buttons are
  `type="button"`.
- Mandatory fields (title, start, end, affected systems) carry `Label required`
  affordances, and the datetime/systems groups are associated with their
  controls via `role="group"` + `aria-labelledby`.
- The title field auto-focuses when the dialog opens.
- An unsaved-changes guard via `useUnsavedChanges` blocks close/navigation when
  the form is dirty and routes through a discard-confirmation modal.
