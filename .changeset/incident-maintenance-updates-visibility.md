---
"@checkstack/ui": minor
"@checkstack/incident-common": minor
"@checkstack/incident-backend": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-backend": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/catalog-common": minor
"@checkstack/catalog-backend": patch
"@checkstack/catalog-frontend": patch
"@checkstack/status-page-frontend": minor
---

Incidents and maintenance: richer, safer update timelines.

- **Markdown updates and descriptions.** Update messages and descriptions now
  render sanitized Markdown (bold, links, lists) everywhere they appear -
  detail pages, editors, the shared status-update timeline, and the public
  status page (which stays sanitized via `rehype-sanitize`). An "Markdown
  supported" hint is shown under the update composer.
- **Edit and delete published updates.** New `editUpdate` / `deleteUpdate`
  procedures let a manager correct or remove an update in place; edited updates
  are marked "edited". Editing the `statusChange` of the latest update
  re-derives the incident/maintenance status. Deletion is irreversible and, on
  the AI path, always routes through propose/apply. Both procedures are
  object-scoped on the owning incident/maintenance (`idParam`), so team-scoped
  managers can use them without a global rule.
- **Edit the published time of an update.** `editUpdate` now accepts an optional
  `createdAt`, and the update editor exposes a date/time picker (the same
  `DateTimePicker` used for maintenance windows) when editing an existing update.
  Re-timing an update re-orders the timeline and re-derives the incident/
  maintenance status (the header still follows the latest status-bearing
  update), so moving an update never leaves the header and timeline diverged.
- **Per-update edit history (GitHub-style "history of edits").** Each in-place
  edit now archives the prior version of the update into a new durable
  `edit_history` `jsonb` column (a snapshot of message, status, visibility, and
  the published time it carried, plus when it was superseded). The shared status
  timeline turns the "edited" marker into an "edited (N)" disclosure that
  expands to show those prior versions. History is **manager-facing only**: the
  read path attaches `editHistory` solely for the manager audience and strips it
  for public / logged-in readers, so a version that was `internal` before being
  made `public` can never leak its prior internal content. A no-op edit
  (nothing actually changed) neither archives a snapshot nor marks the update
  "edited". Adds a forward-only, additive migration to each backend
  (`edit_history jsonb NOT NULL DEFAULT '[]'`, backfilling existing rows).
  We framed this as "either a delayed publish with undo OR a history of
  edits"; edit history satisfies the ask, so undo-send / delayed-publish is
  intentionally **deferred** (it would need a queue-delay + pending state and is
  redundant with history).
- **Status updates are now editable from the editor dialog too, via one shared
  implementation.** The status-updates surface (add / edit / delete an update,
  including its published time and edit history) is extracted into a single
  `IncidentUpdatesSection` / `MaintenanceUpdatesSection` used by BOTH the detail
  page and the create/edit editor dialog, so the two surfaces can no longer
  drift. Previously the editor dialog showed a read-only timeline with no way to
  edit an existing update.
- **Editable hotlinks.** Added-links can now be edited in place (label, URL, and
  visibility where applicable) instead of only added/removed. The shared
  `LinksEditor` gains an inline edit affordance, backed by a new `updateLink`
  procedure on incidents and maintenances and `updateSystemLink` on catalog
  systems (so system links are editable too). Each is object-scoped on its
  parent (`incidentId` / `maintenanceId` / `systemId`) with the same anti-spoof
  WHERE-clause scoping as the remove path, so a link id cannot be paired with a
  foreign parent the caller happens to manage. No migration is needed (the
  columns already exist).
- **Per-update / per-link visibility.** A new shared visibility level
  (`public` / `logged_in` / `internal`) can be set on both updates and hotlinks
  via the same three-way visibility select in the editor (the update composer
  previously exposed only a binary public/internal toggle, so `logged_in` was
  unreachable for updates even though the backend already accepted and filtered
  it). Filtering is enforced SERVER-SIDE on every read path: anonymous callers
  and the public status-page projection see only `public`; authenticated
  non-managers additionally see `logged_in`; managers see everything. Updates
  still default to `public`, and `internal` updates never broadcast a
  notification. Adds a forward-only migration to each backend (new visibility
  enum + column, plus a nullable `edited_at` on updates).
- **"Keep Current" shows the current status**, e.g. "Keep Current
  (Investigating)".
- **Status colors.** Adds a blue `--status-info` token and a shared
  `StatusPillTone` / `pillToneStyles` in `@checkstack/ui`; incident "monitoring"
  and maintenance "scheduled" now read as informational (blue) instead of grey.
  The incident severity ramp is now blue(minor) -> amber(major) -> red(critical):
  a minor incident uses the blue `info` hue instead of grey, with no minor/major
  amber collision. This corrected ramp now also applies on the public status
  page (active-incident cards, severity pills, and the incident detail page) and
  in the system-detail active-incidents panel, which both previously still
  rendered `minor` grey.
- **Logged-out overview.** Incidents and maintenance now expose a public,
  read-gated overview page and sidebar entry (the manage-gated config page is
  renamed "Manage ..."), so anonymous visitors who hold the default read rule
  can browse them.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
