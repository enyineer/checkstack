---
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-frontend": minor
---

Slim the "Edit Incident" and "Edit Maintenance" dialogs and move each entity's
living, self-persisting data onto its detail page. Both dialogs were crammed
`max-w-4xl` modals that mixed a deferred-save form with self-persisting panels.
They now carry only the fields the Save button persists - for incidents: title,
description, severity, affected systems, health override, and notification
suppression; for maintenances: title, description, schedule, affected systems,
and notification suppression - plus the create-only team ownership picker. The
dialogs drop to `max-w-2xl` and, when editing, show a hint linking to the
entity's detail page for everything else. Nothing was lost; each surface moved
or already existed elsewhere:

- **Status updates** are no longer duplicated in the dialog. The detail page
  already rendered the same fully-editable `IncidentUpdatesSection` /
  `MaintenanceUpdatesSection` (each internally manage-gated), so the dialog's
  copy was a pure duplication and is removed.
- **Hotlinks** now render as an editable `LinksEditor` section on the detail
  page for anyone who can manage the entity (the existing read-only twin stays
  for viewers who cannot). It self-persists via the add/update/remove
  mutations, refetching the entity on success.
- **Team access** ("who can change this") is now managed on the detail page via
  `TeamAccessEditor` (managers only) instead of in the dialog. The read-only
  "managed by" indicator from the details slot is unchanged.

The detail-page manage sections are gated on the same per-resource manage
verdict the status-updates section already used (`accessApi.useResourceAccess`
on the entity), so non-managers keep read-only surfaces and never see broken or
disabled editors.
