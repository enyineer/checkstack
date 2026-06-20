---
"@checkstack/notification-common": minor
"@checkstack/notification-backend": patch
"@checkstack/notification-teams-backend": patch
"@checkstack/notification-pushover-backend": patch
---

feat(notification-common): HTML and label subject-render helpers

Add `renderSubjectsAsHtml` and `renderSubjectLabel` to
`@checkstack/notification-common` (re-exported from
`@checkstack/notification-backend`) so the last two notification channels that
still hand-rolled their affected-subjects markup are single-sourced.

- `renderSubjectsAsHtml` renders the subjects as an HTML `<ul>` (the canonical
  `<b>Affected:</b><ul><li>...</li></ul>` Pushover fallback). It now
  HTML-escapes subject names and URLs (previously interpolated raw) and prefixes
  the status emoji when a subject carries a status hint.
- `renderSubjectLabel` returns just `<marker> <name>` for rich-card channels
  (Teams) that lay out the URL in their own structure but want the consistent
  status-emoji-or-bullet prefix.

The Pushover (HTML list) and Teams (FactSet title) strategy plugins now route
their subject rendering through these helpers. Output is unchanged for ordinary
subject names; the Teams FactSet title now carries the shared bullet prefix and
the Pushover HTML is now escaped, both behavior-preserving for non-markup data
and pinned by unit tests.
