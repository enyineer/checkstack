---
"@checkstack/queue-frontend": minor
"@checkstack/cache-frontend": minor
"@checkstack/script-packages-frontend": minor
"@checkstack/pluginmanager-frontend": minor
---

Standardize number/byte/relative-time formatting and unify loading/empty/error
states across the queue, cache, script-packages, and pluginmanager admin
surfaces.

Byte sizes now route through the shared `formatBytes` helper from
`@checkstack/ui` with a single binary (KiB/MiB/GiB) convention, so cache,
script-packages, and pluginmanager no longer disagree on units. Number counts
use the shared `formatNumber`, and the queue runtime panel's job "ago" times use
the shared `formatRelativeTime` (date-fns) instead of hand-rolled math.

The queue runtime panel's job listing now renders failed loads via the shared
`QueryErrorState` (with a Retry button) and empty listings via the shared
`EmptyState`, replacing bare inline text. Error-bearing toasts on plugin
install/uninstall now use the canonical `toastError`/`toastSuccess` helpers.

These are presentation-only changes; the underlying values and the labels /
column headers / empty-state copy that the panels render are unchanged.
