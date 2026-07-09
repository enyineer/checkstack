---
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
---

Name the failing health check in system-health notifications. The notification
body now names the check that drove the transition (in addition to the system
and environment), and a `healthcheck.healthcheck` subject is pushed alongside
the `catalog.system` subject, deep-linked to the check's run history. Recovery
notifications stay system-level. Adds a `createHealthcheckSubject` builder to
`healthcheck-common`.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
