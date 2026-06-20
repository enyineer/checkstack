---
"@checkstack/about-frontend": patch
"@checkstack/ai-frontend": patch
"@checkstack/announcement-frontend": patch
"@checkstack/anomaly-frontend": patch
"@checkstack/api-docs-frontend": patch
"@checkstack/auth-frontend": patch
"@checkstack/automation-frontend": patch
"@checkstack/cache-frontend": patch
"@checkstack/catalog-frontend": patch
"@checkstack/command-frontend": patch
"@checkstack/dashboard-frontend": minor
"@checkstack/dependency-frontend": patch
"@checkstack/frontend": minor
"@checkstack/gitops-frontend": patch
"@checkstack/healthcheck-frontend": minor
"@checkstack/incident-frontend": patch
"@checkstack/infrastructure-frontend": patch
"@checkstack/integration-frontend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/notification-frontend": patch
"@checkstack/pluginmanager-frontend": patch
"@checkstack/queue-frontend": patch
"@checkstack/satellite-frontend": patch
"@checkstack/script-packages-frontend": patch
"@checkstack/secrets-frontend": patch
"@checkstack/slo-frontend": minor
"@checkstack/status-page-frontend": patch
"@checkstack/theme-frontend": minor
"@checkstack/tips-frontend": patch
"@checkstack/ui": minor
---

Design-system rework: a premium, consistent UI language across the platform.

Foundation (`@checkstack/ui` + the shared Tailwind preset):
- A token system wired into the shared preset so it generates app-wide: a
  surface elevation ramp (`surface` / `surface-2` / `surface-inset`), the
  aurora gradient stops, a colorblind-safe `status` triad, and `grid-line`.
- A density model (`comfortable` / `compact`) via `--d-*` vars + `DensityProvider`
  / `useDensity`, with a user-menu density toggle, plus the polished
  skeleton / empty / error state set.
- Honest, token-driven chart primitives (`TimeSeriesChart`, `Sparkline`,
  `RadialGauge` / aurora hero, `RequestWaterfall`, `UptimeRibbon`).
- A signature aurora moment per page: `PageHeader` paints its icon strokes with
  the aurora gradient and adds a hairline; `Card` gains soft layered depth.

Shell + surfaces:
- The app shell adopts the elevation ramp (header `surface-2`, sidebar
  `surface`, content on the ambient base).
- The system-health dashboard, health-check latency / single-run views, and the
  SLO dashboard are reskinned onto the primitives (aurora confidence gauge,
  honest p50/p95 latency, request waterfall, number-led status cards).

App-wide adoption + premium rework:
- Every plugin frontend adopts the tokens, status triad, density, and elevation.
- The highest-impact surfaces in each plugin are then redesigned to a premium
  bar: real depth, number-led hierarchy, multi-encoded status (pill + dot +
  accent stripe), and refined list/table density. Several plugins extract pure
  tone/label/format logic into unit-tested modules.

Alerts:
- Every alert/callout is unified onto a single premium `Alert` (depth surface +
  status-accent stripe + toned icon chip, variant-driven).

BREAKING CHANGE: the duplicate `InfoBanner` component (and its sub-components)
is removed; use `Alert` instead - it is a drop-in replacement with the same
variants and composable parts.
