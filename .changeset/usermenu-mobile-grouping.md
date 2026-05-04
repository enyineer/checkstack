---
"@checkstack/ui": patch
"@checkstack/frontend-api": minor
"@checkstack/auth-frontend": minor
"@checkstack/announcement-frontend": patch
"@checkstack/api-docs-frontend": patch
"@checkstack/catalog-frontend": patch
"@checkstack/dependency-frontend": patch
"@checkstack/gitops-frontend": patch
"@checkstack/healthcheck-frontend": patch
"@checkstack/incident-frontend": patch
"@checkstack/infrastructure-frontend": patch
"@checkstack/integration-frontend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/notification-frontend": patch
"@checkstack/pluginmanager-frontend": patch
"@checkstack/satellite-frontend": patch
"@checkstack/slo-frontend": patch
---

Fix mobile UserMenu items rendering at zero height, group menu items by
section, and unstack cramped card headers on small viewports.

- **UserMenu mobile bug**: On mobile, the user-menu Sheet rendered every
  menu item as a grid row, which combined with `flex-shrink: 1` on each
  item collapsed the buttons whose internal layout uses `display: flex`
  (the items registered with `useNavigate` rather than `<Link>`) to zero
  content height. Switched the mobile container to a flex column with
  `[&>*]:shrink-0` and added `min-h-0` so the sheet scrolls correctly
  when the list overflows.

- **UserMenu grouping**: Slot extensions now accept an optional `group`
  field. The user menu buckets `UserMenuItemsSlot` extensions by `group`
  and renders each group under a labeled header (`Workspace`,
  `Reliability`, `Configuration`, `Documentation`, `Account`). Existing
  core plugins are tagged with the appropriate group; third-party plugins
  can pick any of these or supply their own label. Untagged extensions
  render last with no header. `UserMenuItemsBottomSlot` is unaffected.

- **Card header responsiveness**: `CardHeaderRow` (the primitive shared by
  Incident, Maintenance, Auth, Catalog, GitOps and other config cards) now
  stacks vertically on narrow viewports and only switches to a single row
  at the `sm` breakpoint, so titles and adjacent filter controls (e.g.
  status `Select`, "Show resolved" checkbox) no longer cram together on
  mobile. Refactored the Incident and Maintenance config pages to use the
  primitive instead of a hand-rolled `flex items-center justify-between`
  row, and made their `Select` triggers full-width on mobile.
