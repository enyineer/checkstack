---
"@checkstack/healthcheck-frontend": patch
---

Fix a console 400 when creating a new health check: the IDE config plugin slots
(e.g. the Anomaly "Template Anomaly Defaults" panel) mounted on the `"new"` route
sentinel and fired parent-scoped queries (`getAnomalyConfig` /
`getConfiguration`) with a non-existent id. The truthy `"new"` sentinel is now
collapsed to `undefined`, so those slots do not mount and every
`enabled: !!configurationId` guard works until the check is first saved. The
Anomaly Defaults tab still appears immediately after the first save.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
