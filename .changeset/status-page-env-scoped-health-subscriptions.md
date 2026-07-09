---
"@checkstack/notification-common": minor
"@checkstack/notification-backend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/status-page-backend": minor
"@checkstack/incident-backend": minor
"@checkstack/maintenance-backend": minor
---

fix(status-page): scope email subscriptions to published environments and author-selected systems

Two correctness fixes to status-page email subscriptions:

- **Health notifications now respect the page's published environments.** A
  per-environment health transition carries the environment it happened in
  (`originEnvironmentId`, threaded through `notifyForSubscription` ->
  `NotificationAudienceEvent` -> the status-page fan-out). A page that publishes
  a specific environment set is now skipped for a change in an environment it
  does not publish - so a `development` failure never emails a prod-only page's
  subscribers, even for a system that is also shown in prod. Pages publishing all
  environments, and env-less sources (incident, maintenance, whole-system health
  rollup), are unaffected.
- **Notifications are scoped per category to the widgets the author placed.** The
  send-time fan-out now surfaces a notification only through widgets of its own
  category: a health status change reaches a page only through a HEALTH widget
  (`banner` / `systemHealth` / `groupStatus` / `uptime`, which now implement
  `resolveScopedSystems` and declare `subscriptionCategory: "health"`), an
  incident only through an incident widget, and so on. A page that lists a
  system's incidents but never its health no longer emails health subscribers
  about it, and a health-only page now correctly surfaces its systems for
  subscription. Health widgets also participate in the public subscribe picker.

BREAKING CHANGE: on a page publishing a specific environment set, health
subscribers now only receive changes that occurred in a published environment
(previously any environment of a surfaced system triggered a notification), and a
notification is surfaced only by a widget of its own category (previously any
scoping widget on the page could surface any category). Legacy subscribers (NULL
categories) and all-environment pages are unchanged; no data migration is needed.
