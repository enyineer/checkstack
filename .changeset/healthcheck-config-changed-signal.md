---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
---

fix(healthcheck): emit a realtime signal on config/assignment changes

The health-check executor broadcasts run/status signals, but config and
assignment CRUD (create/update/delete/pause/resume, associate/disassociate,
create-and-assign) emitted nothing - so a check created or edited out-of-band
(the AI assistant, GitOps, another pod/user) did not appear in an open Health
Checks list until the first run fired a status signal, up to an interval later.

Add a `HEALTHCHECK_CONFIG_CHANGED` (`healthcheck.config.changed`) signal,
broadcast from every config/assignment mutation, so the frontend signal
auto-invalidator refreshes the `[[healthcheck]]` cache on every connected client
immediately.
