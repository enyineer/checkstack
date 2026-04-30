---
"@checkstack/notification-common": minor
"@checkstack/notification-backend": minor
"@checkstack/notification-frontend": minor
"@checkstack/catalog-common": minor
"@checkstack/catalog-backend": minor
"@checkstack/catalog-frontend": patch
"@checkstack/incident-common": minor
"@checkstack/incident-backend": minor
"@checkstack/maintenance-common": minor
"@checkstack/maintenance-backend": minor
"@checkstack/anomaly-common": minor
"@checkstack/anomaly-backend": patch
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": patch
"@checkstack/dependency-common": minor
"@checkstack/dependency-backend": patch
"@checkstack/backend-api": minor
"@checkstack/notification-smtp-backend": patch
"@checkstack/notification-slack-backend": patch
"@checkstack/notification-discord-backend": patch
"@checkstack/notification-teams-backend": patch
"@checkstack/notification-telegram-backend": patch
"@checkstack/notification-pushover-backend": patch
"@checkstack/notification-gotify-backend": patch
"@checkstack/notification-webex-backend": patch
"@checkstack/notification-backstage-backend": patch
---

Bulk notifications affecting multiple systems and collapse lifecycle events into a single card.

Notifications now carry an optional `subjects` array (the entities they affect) and an optional `collapseKey` (so related notifications collapse into one row per recipient). Incidents, maintenances, anomalies, healthchecks, and dependency-impact events route through these new fields, so an incident affecting three systems produces one in-app notification + one external send per subscriber instead of three. Lifecycle updates for the same entity (created → updated → resolved) also collapse, with an expandable "+N updates" timeline.

Subject kinds are namespaced as `<pluginId>.<localKind>` and built via type-safe helpers exported from each domain's common package (`createSystemSubject`, `incidentCollapseKey`, etc.). The frontend kind registry (`registerSubjectKind`) lets plugins bind icon + label for their kinds; unknown kinds fall back to a generic chip.

All notification strategies (SMTP, Slack, Discord, Teams, Telegram, Pushover, Gotify, Webex, Backstage) render the affected subjects natively in their format (HTML cards, Slack blocks, Discord embed fields, adaptive cards, markdown lists, etc.).
