---
"@checkstack/ui": minor
"@checkstack/common": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/healthcheck-http-backend": patch
"@checkstack/healthcheck-tls-backend": patch
"@checkstack/healthcheck-ping-backend": patch
"@checkstack/healthcheck-dns-backend": patch
"@checkstack/healthcheck-tcp-backend": patch
"@checkstack/healthcheck-grpc-backend": patch
"@checkstack/healthcheck-mysql-backend": patch
"@checkstack/healthcheck-postgres-backend": patch
"@checkstack/healthcheck-redis-backend": patch
"@checkstack/healthcheck-rcon-backend": patch
"@checkstack/healthcheck-ssh-backend": patch
"@checkstack/healthcheck-script-backend": patch
"@checkstack/healthcheck-jenkins-backend": patch
"@checkstack/collector-hardware-backend": patch
---

Unify the healthcheck chart system on the `@checkstack/ui` SVG kit and
redesign the HealthCheck drawer.

- `@checkstack/ui` gains six chart primitives (each with a Storybook story):
  `StackedTimeline` (stacked status counts per bucket on the colorblind-safe
  status triad), `ChartTooltip` + `useBandHover` (the one shared chart
  tooltip and its cursor hit-testing), `ChartCard` / `chartCardChromeClass`
  (the premium gradient card chrome, flat on low-power devices), `StatTile`
  (number-led metric tile with delta chip, sparkline/ribbon footer, and
  click-to-expand disclosure), `DistributionBar` (stacked horizontal
  distribution + legend, replaces pies), and `CategoryRibbon` (categorical
  history ribbon). `TimeSeriesChart` gains a hover tooltip with a crosshair
  marker.
- `@checkstack/common` adds four optional chart metadata keys to
  `BaseHealthResultMeta`: `x-chart-priority` (tile sort weight, lower first,
  default 100), `x-chart-good-direction` (`"up" | "down"`, which direction
  of change is an improvement; consumers fall back to
  `x-anomaly-direction`), and `x-chart-true-label` / `x-chart-false-label`
  (prose for a boolean field's values wherever they surface in text, e.g. a
  dominance chip reading "Usually successful (98%)" instead of "Usually
  true"). Built-in collector backends annotate their headline metrics and
  boolean fields accordingly (purely additive metadata).
- `@checkstack/healthcheck-frontend` rebuilds the drawer: a hero status
  banner (status pill, healthy %, avg latency, interval, last run with the
  exact datetime on hover, full-width status ribbon) replaces the metric
  tiles; the status timeline and latency heroes share the `ChartCard`
  chrome; the auto-generated charts become a prioritized, click-to-expand
  2-up tile grid (collector ids demoted to hover titles); the anomaly
  Expected/Trend derivation is consolidated into one tested module shared by
  the latency hero and the tiles.

BREAKING CHANGES: `recharts` is removed from `@checkstack/healthcheck-frontend`
(and the unused dependency from `@checkstack/ui`); the
`HealthCheckStatusTimeline` and `SparklineTooltip` components are deleted.
Extensions rendering into `HealthCheckDiagramSlot` should build on the
`@checkstack/ui` chart primitives instead.
