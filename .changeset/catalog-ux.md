---
"@checkstack/catalog-frontend": minor
"@checkstack/catalog-common": minor
"@checkstack/catalog-backend": minor
"@checkstack/healthcheck-frontend": minor
---

Redesign the catalog into a group-first browse view and tabbed management tables, with inline health rollups.

- Browse view: the catalog home is a real read-only, scale-built experience - collapsible group sections (with member counts) plus a synthetic Ungrouped section, a shared toolbar (search, group/health/tag filters, density toggle), URL-backed view state (shareable deep links), polished empty states, and a manager-only "Manage catalog" link. Per-system status badges render through the existing `SystemStateBadgesSlot`; filtering is client-side over the loaded set.
- Management: redesigned as tabbed data tables (Systems / Groups / Environments) replacing the two-column drag-to-assign layout. Systems get multi-select + a bulk bar, inline health, and group + environment membership as removable chips with type-ahead pickers (portaled so they are never clipped); Groups get inline rename and member chips; Environments get a name / members / field-count table (CRUD gated by `catalog.environment.manage`). GitOps-locked rows stay read-only. Drag-and-drop (and `@dnd-kit` on this page) is removed; the management page also shares the browse toolbar.
- Inline health rollups: a new platform contract `CatalogBrowseHealthSlot` (`@checkstack/catalog-common`) - an additive optional slot catalog-frontend only consumes (a headless data boundary feeding group rollups + the health filter), with a catalog-owned `CatalogHealthStatus` vocabulary so catalog gains no health-plugin dependency. Group headers show a rollup pill derived from the reported status DATA (a system absent from the map is `"unknown"`, never healthy); all-healthy groups start collapsed. The health filter is wired on both toolbars and enables once a filler reports. healthcheck-frontend fills the slot by reusing dashboard-frontend's `SystemBadgeDataProvider`. When no health source is installed the slot is unfilled and the catalog stays fully functional.

This is a beta minor.
