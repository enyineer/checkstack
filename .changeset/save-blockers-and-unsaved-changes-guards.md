---
"@checkstack/automation-frontend": minor
"@checkstack/healthcheck-frontend": minor
---

Explain why Save is disabled and guard against losing unsaved edits in the
automation and health-check editors.

- A greyed-out Save is no longer a dead end: both editors now render a
  "N issue(s) blocking" affordance next to the Save button. Opening it
  lists every blocker, and clicking one jumps to the offending field/section
  (the automation Name / Run-as fields or the visual definition editor; the
  health-check tree node that owns the issue). The existing validation logic is
  unchanged - the blockers are just surfaced and made actionable.
- The first field of a fresh automation (Name) now auto-focuses so keyboard-first
  users can type immediately.
- Both editors now use the shared `useUnsavedChanges` hook for unsaved-changes
  protection: a native prompt on tab close / refresh plus an in-app
  "Discard unsaved changes?" confirmation when navigating away mid-edit. The
  health-check editor's previous hand-rolled `beforeunload` listener is migrated
  to the shared hook; the automation editor gains dirty tracking and the same
  guard.
