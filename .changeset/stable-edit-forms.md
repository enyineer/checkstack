---
"@checkstack/ui": minor
"@checkstack/catalog-frontend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/ai-frontend": patch
"@checkstack/announcement-frontend": patch
"@checkstack/anomaly-frontend": patch
"@checkstack/auth-frontend": patch
"@checkstack/cache-frontend": patch
"@checkstack/gitops-frontend": patch
"@checkstack/notification-frontend": patch
"@checkstack/queue-frontend": patch
"@checkstack/satellite-frontend": patch
"@checkstack/secrets-frontend": patch
"@checkstack/slo-frontend": patch
"@checkstack/status-page-frontend": patch
"@checkstack/telemetry-frontend": patch
---

Edit forms stay stable while you are typing. Previously, editing a system's
description (and many other edit dialogs/settings pages) would reset the field
mid-edit whenever a webhook update or realtime signal refetched the underlying
query: the form re-seeded its local state from the fresh query result on every
refetch. Forms now seed their local state ONCE - on the dialog's open
transition, or once per record via a stable key - and ignore background
refetches while you are editing.

New shared primitive `useSeedFormOnOpen(open, onInit)` in `@checkstack/ui`
(alongside the existing `useInitOnceForKey`) seeds a dialog form once per
open transition, StrictMode-safe. Fixed surfaces include the catalog
system/environment/group editors, the healthcheck platform-defaults dialog,
the SLO / gitops-provider / telemetry-source / satellite / announcement /
role edit dialogs, and the cache / queue / notification / secrets / anomaly /
profile / strategies settings pages (query-seeded pages also drop their loader
cache via `gcTime: 0` so a warm cache cannot race the one-shot seed).
