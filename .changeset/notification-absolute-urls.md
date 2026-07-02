---
"@checkstack/notification-common": minor
"@checkstack/notification-backend": minor
---

Fully-qualify affected-system links in external notifications. Previously only
the primary call-to-action (`action.url`) was made absolute before dispatch,
while the "Affected" subject deep links (`subjects[].url`, e.g.
`/catalog/systems/...`) were delivered as relative paths. In external channels
(email, Slack, Teams, Discord, and so on) a relative path has no origin to
resolve against, so those links were broken.

A new pure helper `qualifyNotificationUrls` (and the underlying `toAbsoluteUrl`)
lives in `@checkstack/notification-common` and is applied at the single external
dispatch chokepoint in `@checkstack/notification-backend`, qualifying both the
action URL and every subject URL against the instance's configured `BASE_URL`.
Already-absolute `http(s)` URLs are left untouched, and the helper returns new
objects so the shared payload is never mutated across recipients or strategies.

The in-app notification path is unchanged: those links stay relative so the SPA
router resolves them.

BREAKING CHANGE (behavioral): when `BASE_URL` is not configured, external
delivery previously aborted the channel entirely. It now logs a warning and
still delivers with links left relative, so a missing `BASE_URL` degrades
gracefully instead of silently dropping notifications. Set `BASE_URL` to your
instance's public URL for links to resolve correctly in external channels.
