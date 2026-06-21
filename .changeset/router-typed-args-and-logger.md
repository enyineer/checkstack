---
"@checkstack/incident-backend": patch
"@checkstack/maintenance-backend": patch
"@checkstack/notification-backend": patch
"@checkstack/command-backend": patch
"@checkstack/catalog-backend": patch
---

refactor: typed router-factory args and structured logging

Internal router factories that took long positional argument lists
(`incident-backend`, `maintenance-backend`, and `notification-backend`'s
`createNotificationRouter`) now take a single typed `deps` object, matching the
`RouterDeps` convention already used by sibling routers and removing a class of
easy-to-transpose call sites.

Backend code paths that wrote to `console.*` now use the injected structured
`Logger` so they respect log levels and correlation: the catalog router's
notification-resource lifecycle warnings, the notification OAuth callback
handler's errors, and the command router's search-provider failures. The
command router factory now takes a typed `{ logger }` object.
