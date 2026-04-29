---
"@checkstack/healthcheck-common": minor
"@checkstack/cache-memory-common": minor
"@checkstack/auth-ldap-backend": patch
"@checkstack/auth-saml-backend": patch
"@checkstack/collector-hardware-backend": patch
"@checkstack/healthcheck-dns-backend": patch
"@checkstack/healthcheck-grpc-backend": patch
"@checkstack/healthcheck-http-backend": patch
"@checkstack/healthcheck-jenkins-backend": patch
"@checkstack/healthcheck-mysql-backend": patch
"@checkstack/healthcheck-ping-backend": patch
"@checkstack/healthcheck-postgres-backend": patch
"@checkstack/healthcheck-rcon-backend": patch
"@checkstack/healthcheck-redis-backend": patch
"@checkstack/healthcheck-script-backend": patch
"@checkstack/healthcheck-ssh-backend": patch
"@checkstack/healthcheck-tcp-backend": patch
"@checkstack/healthcheck-tls-backend": patch
"@checkstack/integration-jira-backend": patch
"@checkstack/integration-jira-common": patch
"@checkstack/integration-teams-backend": patch
"@checkstack/integration-webex-backend": patch
"@checkstack/integration-webhook-backend": patch
"@checkstack/notification-backstage-backend": patch
"@checkstack/notification-discord-backend": patch
"@checkstack/notification-gotify-backend": patch
"@checkstack/notification-pushover-backend": patch
"@checkstack/notification-slack-backend": patch
"@checkstack/notification-smtp-backend": patch
"@checkstack/notification-teams-backend": patch
"@checkstack/notification-telegram-backend": patch
"@checkstack/notification-webex-backend": patch
"@checkstack/queue-bullmq-backend": patch
"@checkstack/queue-memory-backend": patch
---

## Downstream consumer bumps for the anomaly detection + cache system rollout

Packages on this branch were updated as part of the anomaly detection feature (schema annotations on result fields, plugin metadata for the modular cache system) but were not listed in the upstream changesets.

- **`@checkstack/healthcheck-common`** (minor) — new RPC contract additions and schema changes supporting per-field anomaly metadata.
- **`@checkstack/cache-memory-common`** (minor) — new package providing access rules + plugin metadata for the in-memory cache backend.
- **healthcheck plugins** (patch) — adopt the new `x-anomaly-*` schema annotations on their result fields so anomaly detection works automatically against their checks. No public API changes.
- **integration / notification / auth / queue / collector plugins** (patch) — minor internal updates as consumers of upstream API changes (cache plugin registry, schema additions). No public API changes.
