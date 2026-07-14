---
"@checkstack/ui": patch
"@checkstack/logstream-frontend": patch
"@checkstack/metricstream-frontend": patch
---

Fix chart stretching and loading layout shift in the log-stream and
metric-stream chart surfaces.

- `TimeSeriesChart` now measures its container and projects the geometry at
  1 viewBox unit = 1 CSS px (re-measured on resize) instead of stretching a
  fixed 720-unit viewBox with `preserveAspectRatio="none"`, so y-axis tick
  labels and line weights render undistorted at every width. The SVG is only
  rendered once the real width is known, while the fixed-height wrapper
  reserves the space - no layout shift and no wrongly-scaled first paint.
- The log explorer's "Pattern occurrences" chart keeps the last built chart on
  screen during refetches (`placeholderData`), quantizes its fallback
  "last 24h" window to the minute so re-renders no longer churn the query key
  (previously every parent re-render - a keystroke, expanding a log row -
  minted a new `Date`, triggering a refetch and a skeleton flash), and is
  memoized so unrelated explorer state changes skip the chart subtree
  entirely.
- The pattern-occurrences and metric-explorer charts now use the shared 192px
  `chart` footprint, matching their skeleton and empty states so swapping
  between loading / empty / chart never shifts the layout.
