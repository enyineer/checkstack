---
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-frontend": minor
---

Report an incident or schedule maintenance straight from a system

The system overview showed a system's incidents and maintenances but offered no
way to open one for it - you had to navigate to the incidents/maintenance page
and re-pick the system by hand.

Both panels now carry an action ("Report incident" / "Schedule maintenance")
that deep-links to the editor with the system already selected, via
`?action=create&systemId=<id>`. The pages consume both params and clear them, so
a refresh doesn't reopen the dialog.

The action is gated on `useProcedureAccess` over the CREATE procedure's
contract, so it appears for a global manager AND for someone who can manage this
system through a team (the `create.parent` gate) - exactly who the backend
accepts. Gating on the bare global rule would have hidden it from the
team-scoped users it is most useful to.

The editors' unsaved-changes baseline accounts for the pre-selection, so opening
a pre-scoped form and closing it again doesn't falsely prompt to discard.
