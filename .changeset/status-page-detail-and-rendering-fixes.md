---
"@checkstack/status-page-backend": patch
"@checkstack/status-page-common": patch
"@checkstack/status-page-frontend": patch
"@checkstack/incident-backend": patch
"@checkstack/maintenance-backend": patch
---

Fix status-page detail-page content and status colouring

Thanks to @stuajnht for reporting several public status-page issues (the
announcement-block fix is a separate changeset):

- **Incident/maintenance status text was uncoloured and inline.** Update-timeline
  status changes rendered in the muted grey `text-muted-foreground`, making the
  status hard to tell apart from the message. The status change now sits on its
  own line, coloured by its lifecycle (a new `incidentStatusTone`/`Label` mirrors
  the incident status enum the way `maintenanceStatusTone` mirrors maintenance),
  on both the summary block and the detail pages. The detail-page incident status
  pill next to the title is now coloured too (was a neutral grey pill).

- **Detail pages showed raw markdown.** Individual incident/maintenance pages
  rendered the update body as the raw source string; they now render sanitized
  markdown via `<Markdown>`, like the block.

- **Detail pages showed only a few updates.** The individual pages reused the
  summary block DTO, so they inherited the block's `maxUpdates` cap. Widget types
  now expose an optional `resolveDetail` that returns the ONE item with ALL its
  public updates (no cap) and its long-form description; the incident and
  maintenance widgets implement it, and the status-page backend's
  `resolvePublishedIncident`/`resolvePublishedMaintenance` call it. The detail
  page is gated by the SAME anti-enumeration boundary as the block (the widget's
  live scope), and the result is re-validated against the widget's item DTO, so
  it fails closed exactly like the block.

- **Maintenance detail page showed no description.** The maintenance item DTO
  gained an optional `description`, emitted by `resolveDetail` and rendered as
  markdown on the detail page (the incident detail page already had the field
  plumbed and now renders it too).

Note on maintenance/grey systems (also reported): the maintenance BLOCK already
colours scheduled windows blue. On the SYSTEM-HEALTH widget the blue
"maintenance" tone is applied only while a window is actively `in_progress`; a
future scheduled window leaves the system on its live health, and a system with
no health data reads grey "unknown". That is deliberate and left as-is.
