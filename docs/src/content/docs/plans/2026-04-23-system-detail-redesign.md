---
title: "System Detail Page & Health Check Detail Redesign"
description: "Date: 2026-04-23 Status: Approved Scope: catalog-frontend, healthcheck-frontend, catalog-common, @checkstack/ui"
---
# System Detail Page & Health Check Detail Redesign

**Date:** 2026-04-23  
**Status:** Approved  
**Scope:** `catalog-frontend`, `healthcheck-frontend`, `catalog-common`, `@checkstack/ui`

## Problem Statement

The current system detail page has several UX issues:

1. **No visual hierarchy** — everything is stacked as full-width cards of equal importance
2. **The "System Status" card** shows only badges with no context
3. **Low-value sections** (System Info, Contacts, Groups) take prime visual real estate
4. **Health checks are buried** at the bottom inside heavy accordions requiring clicks to see charts
5. **No "at-a-glance" summary** — users can't instantly read a system's health posture
6. **Chart layout is inconsistent** — mixed card sizes, floating small cards, no visual rhythm

The primary audience is **developers and customers** checking: "Is this system OK right now, and if not, why?"

## Design Overview

The redesign introduces four key structural changes:

1. **Hero Summary Banner** with plugin-extensible metric strip
2. **Two-column content layout** (monitoring left, metadata right)
3. **Health check slide-over drawer** (replaces inline accordion expansion)
4. **Standardized chart zones** (summary tiles + full-width timelines)

---

## 1. Hero Summary Banner

The top of the page becomes a compact, high-density hero section replacing the current separate "System Status" card and header.

### Layout

- **Row 1 (Title bar):** System name (`text-2xl font-bold`) with a prominent overall status indicator (colored dot/icon) to the left. Right side: Subscribe button + Settings gear (admin only). "Back to Dashboard" becomes a breadcrumb above the title.
- **Row 2 (Alert strip):** `SystemDetailsTopSlot` renders here — active incidents, maintenances, dependency alerts as compact color-coded banners. Component API unchanged.
- **Row 3 (Metric strip):** New `SystemOverviewMetricsSlot` — horizontally scrollable row of compact metric tiles. Each plugin contributes a tile (~120px wide) via the shared `MetricTile` component. If no plugins contribute, this row doesn't render.

### Mobile Behavior

The metric strip becomes a horizontally scrollable row with snap points.

### Key Principle

Tiles are fully plugin-driven. A system with no health checks won't show a health tile — graceful degradation by design.

---

## 2. Two-Column Content Layout

Below the hero, the page splits into two columns on desktop, stacking to single column on mobile.

### Grid

```
lg:grid-cols-[1fr_340px]
```

### Left Column (Primary — Monitoring)

- **Health Checks section:** Clean list of health check cards within a single Card container. Each row shows: check name, strategy badge (e.g., "HTTP"), status badge, sparkline (25 runs), last run timestamp. Clicking opens the slide-over drawer (Section 3). No accordions.
- **`SystemDetailsSlot`** renders below health checks for future plugin extensions.

### Right Column (Secondary — Context)

Uses **borderless sections** separated by subtle dividers (not heavy bordered Cards):

- **Description** — short paragraph, muted when empty
- **Contacts** — compact email/name list
- **Groups** — inline pill badges
- **Metadata** — collapsible JSON viewer (only when present)
- **Dates** — Created/Updated as muted inline text

### Mobile Stacking Order

Hero → Alerts → Metrics → Health Checks → System Details Slot → Description → Contacts → Groups → Metadata

---

## 3. Health Check Slide-Over Drawer

Replaces the current inline accordion expansion. Clicking a health check card opens a drawer panel from the right.

### Drawer Specifications

- **Width:** `max-w-2xl` (~672px) on desktop, full-screen on mobile
- **Overlay:** Semi-transparent backdrop dimming the system page
- **Header:** Check name, strategy badge, status badge, "Open Full Detail →" link (navigates to existing `HealthCheckHistoryDetailPage`), X close button

### Content Zones

**Zone 1 — Summary Metric Tiles:**

2-column grid of compact stat cards:
- Status (with colored indicator)
- Avg Response Time
- Success Rate (number, not donut)
- Errors (count with run context)
- Strategy-specific narrow metrics via `HealthCheckDiagramSlot`

**Zone 2 — Timeline Charts:**

Full-width stacked:
- Date range filter (preset buttons: 1h, 6h, 24h, 7d, 30d)
- Status Timeline (colored strip)
- Execution Duration (area chart)
- Assertion history sparkline (if applicable)
- Strategy-specific wide charts via `HealthCheckDiagramSlot`

**Zone 3 — Recent Runs:**

Compact table (Status | Time | Source) with pagination and "View all runs →" link to full history page.

### Mobile Behavior

Full-screen overlay with same zone structure, scrollable vertically.

---

## 4. Chart Layout Rethink (AutoChartGrid)

The `AutoChartGrid` component gets a standardized "Sectioned Zones" layout.

### Narrow Metrics (Counter, Gauge, Bar, Pie, Success Rate)

- Render as **uniform stat tiles** — fixed height (~100px)
- Content: title (small, muted), prominent value (large, mono font), optional micro-visualization (tiny sparkline/indicator, max 40px)
- Grid: `grid-cols-2 md:grid-cols-3`
- **All tiles MUST be the same height**

### Wide Timelines (Line, Boolean, Text/Status, Assertion)

- Render as **full-width chart cards** with consistent height (~180px chart area)
- Compact card header (title left, tooltip right)
- Uniform vertical spacing (`gap-4`)

### Visual Separator

Collector groups use a muted uppercase caption label (e.g., "COLLECTOR #1") instead of heavy card headers.

### Key Changes

- No more floating small cards next to empty space
- Consistent card heights within each zone
- Standardized chart area heights
- Donut chart for success rate becomes a percentage number with colored indicator

---

## 5. Extension Slot Changes

### New Slots

| Slot | Package | Context | Purpose |
|------|---------|---------|---------|
| `SystemOverviewMetricsSlot` | `catalog-common` | `{ system: System }` | Plugin-contributed metric tiles in hero banner |

### Modified Behavior (Same API)

| Slot | Change |
|------|--------|
| `SystemDetailsTopSlot` | Now renders inside hero banner area (between title and metrics) |
| `SystemDetailsSlot` | Now renders in left column below health checks |
| `SystemStateBadgesSlot` | Moves from standalone card into hero title bar |
| `HealthCheckDiagramSlot` | Renders inside drawer instead of accordion (same component API) |

### No Changes

- `CatalogSystemActionsSlot` — untouched
- `SystemEditorSlot` — untouched

### New Shared UI Component

`MetricTile` in `@checkstack/ui`:

```tsx
interface MetricTileProps {
  icon: React.ElementType;
  label: string;
  value: string;
  variant?: "default" | "success" | "warning" | "destructive";
  subtitle?: string;
}
```

All `SystemOverviewMetricsSlot` contributors use this for visual consistency.

---

## 6. Plugin Metric Tile Contributions

| Plugin | Tile Label | Value Example | Variant |
|--------|-----------|---------------|---------|
| Health Check | "Health" | "2/2 Healthy" | `success` |
| SLO | "SLO Budget" | "99.95% / 30d" | `success` / `warning` / `destructive` |
| Incident | "Incidents" | "0 active" or "2 active" | `default` / `destructive` |
| Maintenance | "Maintenance" | "None" or "1 scheduled" | `default` / `warning` |

---

## 7. Affected Packages

| Package | Changes |
|---------|---------|
| `catalog-common` | New `SystemOverviewMetricsSlot` definition |
| `catalog-frontend` | Rewrite `SystemDetailPage.tsx` (hero + two-column layout) |
| `healthcheck-frontend` | Rewrite `HealthCheckSystemOverview.tsx` (compact cards + drawer), update `AutoChartGrid` layout |
| `slo-frontend` | Add metric tile extension for `SystemOverviewMetricsSlot` |
| `incident-frontend` | Add metric tile extension for `SystemOverviewMetricsSlot` |
| `maintenance-frontend` | Add metric tile extension for `SystemOverviewMetricsSlot` |
| `@checkstack/ui` | New `MetricTile` component, new `Drawer`/`Sheet` component |

---

## 8. Non-Goals (YAGNI)

- **Tabs** — Not needed; two-column layout provides sufficient organization
- **Hardcoded infrastructure metrics** (CPU, Memory, Disk) — Checkstack is plugin-based; these would come from a future infrastructure plugin
- **Drag-and-drop widget layout** — Over-engineered for the use case
- **Real-time chart streaming** — Existing signal-based refetch pattern is sufficient
