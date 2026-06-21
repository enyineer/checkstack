---
"@checkstack/slo-frontend": minor
---

Upgrade the SLO editor's form quality to match the catalog `SystemEditor` and
`DynamicForm` patterns.

- Inline, per-field validation. A single per-field error map is the source of
  truth for both the inline `FormError` messages and the submit button's
  validity (Create/Update is disabled while any field is invalid). Errors only
  reveal once a field is touched (on blur) or after a submit attempt, so the
  form does not nag while it is first being filled in. Burn-rate warning and
  critical thresholds are now range-checked to `[0, 100]` rather than relying on
  advisory input `min`/`max`. The previous single generic `validation.error`
  toast is gone.
- The dialog body is wrapped in `<form onSubmit>` with the primary button as
  `type="submit"`, so pressing Enter submits.
- Mandatory labels (System, Availability Target, Rolling Window) render the
  `required` affordance.
- Every `Select` is associated with its label via `htmlFor`/`id`, and the Health
  Check Scope and Dependency Exclusion triggers also carry an `aria-label`.
  Invalid fields set `aria-invalid` and `aria-describedby` to their error.
- The first field is auto-focused on open (System when creating, Availability
  Target when editing).
- Unsaved-changes guard via `useUnsavedChanges` from `@checkstack/ui`: a
  `beforeunload` / in-app navigation guard while the open editor has edits, plus
  a "Discard changes?" confirmation when closing the dialog with unsaved edits.
