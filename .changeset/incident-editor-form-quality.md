---
"@checkstack/incident-frontend": minor
---

Upgrade the Incident editor's form quality.

- Inline, per-field validation: a single error map now drives both the inline
  `FormError` messages under the Title and Affected Systems fields and submit
  validity, replacing the submit-only generic toast. Errors reveal on blur /
  after a submit attempt (touched-based) so the form does not nag while typing.
- The editor body is wrapped in `<form onSubmit>` with a `type="submit"`
  primary button, so Enter submits.
- Mandatory fields (Title, Severity, Affected Systems) now render the `Label`
  `required` affordance.
- Every label is associated with its control: the Severity select and the
  Affected Systems group are linked via `aria-labelledby`, and the Title input
  wires `aria-describedby` to its error.
- The Title field auto-focuses when the dialog opens.
- An unsaved-changes guard (via the `useUnsavedChanges` hook) warns on tab
  close / reload and shows a discard confirmation when closing a dirty form.
