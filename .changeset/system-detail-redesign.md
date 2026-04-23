---
"@checkstack/ui": minor
"@checkstack/catalog-common": minor
"@checkstack/catalog-frontend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/slo-frontend": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-frontend": minor
---

Redesign system detail page with hero banner, two-column layout, plugin metric tiles, and health check slide-over drawer.

### New Components
- **MetricTile** (`@checkstack/ui`): Compact stat tile with icon, label, value, variant coloring
- **Sheet** (`@checkstack/ui`): Slide-over drawer built on Radix Dialog primitives

### New Extension Slot
- **SystemOverviewMetricsSlot** (`@checkstack/catalog-common`): Plugin-contributed at-a-glance metric tiles in the system detail hero banner

### Layout Changes
- System detail page now uses a hero banner with breadcrumb, status badges, and metric tile strip
- Two-column layout: monitoring content (left) and system context (right)
- Health checks rendered as compact card rows instead of heavy accordions
- Clicking a health check opens a slide-over drawer with summary tiles, timeline charts, and recent runs
- Right column uses lightweight borderless sections with dividers instead of heavy Card wrappers

### Plugin Extensions
- Health check, SLO, Incident, and Maintenance plugins each contribute a metric tile to the hero banner
