---
"@checkstack/ui": patch
"@checkstack/metricstream-frontend": patch
---

Fix the chart-card toolbar clipping its controls off the right edge. `ChartCard`
rendered its `actions` slot in a non-wrapping, `shrink-0` header row inside an
`overflow-hidden` card, so a wide actions cluster (notably a `DateRangeFilter` in
"Custom" mode, which reveals two datetime pickers) ran past the clipped edge -
the end datetime picker was unreachable and the card title was squeezed to
nothing.

- `ChartCard`: the header now wraps (`flex-wrap` + `min-w-0` on the actions
  wrapper), so a wide actions cluster drops onto its own line instead of
  overflowing. This also fixes the log-stream overview's "Severity over time"
  card, which uses the same pattern.
- Metric stream overview (`MetricQuickChart`): the search + metric-select
  controls are grouped as one wrapping unit and the time-range filter as another,
  so the toolbar wraps into tidy groups and both custom datetime pickers stay
  reachable at every viewport (they stack vertically on mobile).
