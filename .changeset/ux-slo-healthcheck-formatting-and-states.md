---
"@checkstack/slo-frontend": minor
"@checkstack/healthcheck-frontend": minor
---

Apply cross-cutting UX consistency sweeps to the SLO and health-check
frontends.

Formatting: inline date and percentage formatting now routes through the
shared `@checkstack/ui` helpers (`formatDate`, `formatPercent`). The SLO trend
chart and achievement badge no longer hardcode the `en-US` locale, and
availability / error-budget percentages render with a consistent,
locale-aware precision policy.

Success colors: success-semantic palette literals (`text-emerald-*` /
`bg-emerald-*`) in the SLO dependency-exclusion selector and attribution chart
now use the `--success` token so they follow theme and dark-mode adjustments.

Source pill: the health-check runs table's `RunSourceChip` previously
hand-rolled a pill with a hardcoded `orange` palette; it now renders the
shared `Badge` (`warning` for remote, `secondary` for local) so it themes and
matches the surrounding badge row. The displayed "Remote" / "Local" text is
unchanged.

Error state: the SLO overview page now renders a `QueryErrorState` (with a
Retry button) when its list query fails, instead of silently falling through
to the "No SLOs configured" empty state. The branch is additive, so the
existing empty-state copy is unchanged.

Toasts: error-bearing toast call sites now route through the shared
`toastError` / `toastSuccess` helpers for consistent voice and truncation.
Error toasts that previously showed only the raw backend message now read
`"<action>: <message>"` (e.g. `Failed to create: <message>`). Success-toast
text is unchanged.
