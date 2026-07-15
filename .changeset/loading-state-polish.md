---
"@checkstack/ui": minor
"@checkstack/catalog-common": minor
"@checkstack/dashboard-frontend": minor
"@checkstack/catalog-frontend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/anomaly-frontend": patch
"@checkstack/incident-frontend": patch
"@checkstack/slo-frontend": patch
"@checkstack/dependency-frontend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/logstream-frontend": patch
"@checkstack/metricstream-frontend": patch
"@checkstack/tracestream-frontend": patch
---

Smooth out loading states so surfaces no longer flash a wrong resolved state or
pop content in one piece at a time.

- **Dashboard no longer flashes "all systems healthy".** The overview aggregates
  per-system signals from many plugins (health, incidents, SLOs, anomalies,
  dependencies, log/metric/trace streams), each reporting asynchronously - so
  before any had loaded, an empty problem list briefly read as an all-clear.
  `SystemSignalsSlot` gains an additive `onLoadingChange` report; every source
  filler reports its load state, and the dashboard holds its existing skeleton
  until all mounted sources have settled (bounded by a grace period so a
  non-reporting source cannot hang it).
- **System detail overview cards reveal together.** Each `SystemDetailsSlot` card
  self-loads and several self-hide when empty, so they popped in one after
  another. The slot gains an additive `onLoadingChange`; each card reports, and
  the detail page keeps the cards mounted but behind a skeleton set until all
  have settled, then reveals them at once - no stagger, no layout shift, and
  cards with no content simply never appear.
- **Catalog manage "Health" column no longer pops in.** `CatalogBrowseHealthSlot`
  gains an additive `onLoading` report (sourced from the health filler's bulk
  fetch); the manage Systems tab shows a per-row placeholder until the health
  data settles, so the status badges swap in instead of appearing onto an empty
  cell. The same tab also keeps its state badges on one row (side by side)
  instead of wrapping.
- The system detail **Dependencies** and **Logs / Metrics / Traces** cards are now
  collapsed by default: each shows a compact "<title> N" summary and expands its
  detail on click, so the overview column stays short. They render through a new
  shared `CollapsibleDetailCard` (`@checkstack/ui`) that single-sources the header
  layout (icon + title + count + rotating chevron) so every collapsible overview
  card is vertically centred and behaves identically - the earlier per-card header
  markup had drifted and left the Logs/Metrics/Traces titles off-centre when
  collapsed.
- Moved the system detail **SLO card** from the full-width alert strip into the
  left (monitoring) column, so it sits at the same width as the dependencies and
  health cards; only maintenances and incidents stay full width. It now joins the
  coordinated card reveal above.
- Removed a dead, unreferenced duplicate dashboard component
  (`dashboard-frontend/src/Dashboard.tsx`); the live overview is
  `DashboardSystemHealthSection`.

All slot-contract additions are optional/additive - existing fillers and
consumers keep working unchanged.
