---
"@checkstack/anomaly-common": minor
"@checkstack/anomaly-backend": minor
"@checkstack/anomaly-frontend": minor
"@checkstack/notification-common": minor
"@checkstack/notification-backend": minor
"@checkstack/catalog-backend": minor
---

feat(anomaly): per-system and per-field notification mute

Anomaly notifications now flow through their own subscription group
(`anomaly.system.<systemId>`) instead of the shared catalog system group, so
users can opt out of anomaly noise without losing incident or healthcheck
alerts for the same system. On first deploy, existing subscribers of each
`catalog.system.<id>` group are seeded onto the new anomaly group so no one
silently stops getting alerts.

A new mute table (`anomaly_notification_mutes`) backs two granularities:
- **Per-field**: silence a single noisy metric on one system.
- **Per-system**: silence every anomaly for one system in one click.

The system anomaly widget now exposes a bell icon on each anomaly row plus a
`Mute all` toggle in the card header. Mutes are user-scoped and persist
across sessions.

Catalog gains a `systemCreated` hook so anomaly (and any future plugin) can
provision per-system state on creation rather than waiting for a restart.
The notification service gains a `bulkSubscribe` service-RPC used by the
one-time migration described above.
