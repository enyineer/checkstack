---
"@checkstack/notification-common": minor
"@checkstack/notification-backend": patch
"@checkstack/notification-gotify-backend": patch
"@checkstack/notification-webex-backend": patch
"@checkstack/notification-backstage-backend": patch
"@checkstack/notification-telegram-backend": patch
"@checkstack/notification-discord-backend": patch
"@checkstack/notification-slack-backend": patch
---

feat(notification-common): shared subject-render helpers

Add `renderSubjectsAsPlainText` and `renderSubjectsAsMarkdown` to
`@checkstack/notification-common` (re-exported from
`@checkstack/notification-backend`) to single-source the affected-subjects list
that text/markdown notification channels previously each hand-rolled. Both take
the typed `NotificationSubject[]`, honor a subject's `status` (emoji prefix via
`SUBJECT_STATUS_EMOJI`) and `url`, and return an empty string for an empty list.
`renderSubjectsAsMarkdown` supports `linkStyle: "markdown" | "slack"`, a custom
`bullet`, and an optional `heading`.

`SUBJECT_STATUS_EMOJI` now lives in `notification-common` (single source);
`@checkstack/notification-backend` re-exports it unchanged, so its public
surface is stable.

The Gotify, Webex, Backstage, Telegram, Discord, and Slack strategy plugins now
route their subject rendering through these helpers (a behavior-preserving
change pinned by unit tests), which also gives Gotify/Webex/Backstage the
consistent status-emoji prefix they previously dropped. Teams (FactSet) and
Pushover (HTML) keep their structured channel-specific framing.
