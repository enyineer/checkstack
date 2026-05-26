---
"@checkstack/ui": minor
---

Add five additive shared UI primitives for list / query state surfaces:

- `ListEmptyState` - thin wrapper around `EmptyState` with the
  canonical `"No {resource} yet"` headline and an `Inbox` default icon.
- `QueryErrorState` - inline error UI for failed queries; renders an
  `error`-variant `Alert` with `extractErrorMessage` + a Retry button.
- `Skeleton` - pulsing placeholder block that drops its animation when
  `usePerformance().isLowPower` is true.
- `ResponsiveTable` + `MobileCardList` - dual-layout pair for tabular
  data that swaps to a stacked card layout below the `sm` breakpoint
  (pure CSS, no JS media-query gating).
- `toastSuccess` / `toastError` - canonical verb-phrase and
  `{action}: {message}` (truncated at 100 chars) toast helpers.

Each primitive ships with Storybook stories and unit tests. No
existing component or behaviour is changed - Phases 5-7 of the v1
polishing plan will retrofit consumer pages onto these primitives in
follow-up PRs. Phase 7 will use the existing `usePerformance()` hook
directly for low-power gating rather than introducing a separate
className-composition helper.
