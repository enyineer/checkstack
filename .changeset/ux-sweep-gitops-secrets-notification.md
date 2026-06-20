---
"@checkstack/gitops-frontend": patch
"@checkstack/secrets-frontend": patch
"@checkstack/notification-frontend": patch
---

Cross-cutting UX consistency sweep for GitOps, Secrets, and Notification frontends.

Formatting: inline date and relative-time formatting now routes through the
shared `@checkstack/ui` helpers so timestamps agree across the app. GitOps
secret and provider lists use `formatDateTime`; the notification collapsed-group
timeline and notifications page use `formatRelativeTime` (replacing a bespoke
`Intl.RelativeTimeFormat` engine and hand-rolled "5m ago" math).

Semantic colors: success-semantic palette literals now use design tokens. The
secrets backend test-connection result uses `text-success` (was
`text-emerald-600`) and the notification user-channel card active border uses
`border-success/30` (was `border-green-500/30`). The decorative kind-registry
icon uses `text-info` (was `text-blue-500`).

Toasts: error- and success-bearing mutation toasts now use the canonical
`toastError(toast, action, error)` / `toastSuccess(toast, action)` helpers for
consistent voice and 100-char truncation across GitOps provenance actions and
the notification subscription, settings, and notifications surfaces.

No behavior change beyond formatting/voice and theme-token correctness.
