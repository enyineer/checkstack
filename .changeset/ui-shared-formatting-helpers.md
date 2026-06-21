---
"@checkstack/ui": minor
---

Add a shared formatting module (`@checkstack/ui` `src/formatting/`) of pure,
framework-agnostic, locale-aware helpers, re-exported from the package root:

- `formatDate(date)` / `formatDateTime(date)` - short locale-aware date / date-
  time strings. They pass an `undefined` locale (runtime locale) rather than a
  hardcoded one, accept `Date | string | number`, and return `""` for absent or
  invalid input.
- `formatRelativeTime(date)` - "5 minutes ago" / "in 2 hours" via `date-fns`'
  `formatDistanceToNow` (the single chosen relative-time engine).
- `formatNumber(n, opts?)` - locale-aware thousands separators via
  `Intl.NumberFormat` (integer display by default).
- `formatBytes(bytes, opts?)` - defaults to BINARY units (1024-based,
  KiB/MiB/GiB) to match the cache runtime panel; pass `{ binary: false }` for
  decimal (1000-based) units.
- `formatPercent(value, opts?)` - input is a 0-1 ratio by default (`0.42` ->
  "42%"); pass `{ alreadyPercent: true }` for a 0-100 input, plus a
  `fractionDigits` option.
- `formatDuration(ms)` - compact "2h 5m" / "30s" / "500ms" durations.

This is purely additive; existing inline call sites are not yet migrated.
