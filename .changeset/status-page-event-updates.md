---
"@checkstack/status-page-common": minor
"@checkstack/status-page-frontend": minor
"@checkstack/incident-backend": minor
"@checkstack/maintenance-backend": minor
---

Status pages: configurable incident/maintenance updates + recently resolved/completed items.

The Incidents and Maintenance widgets gain four config options (in the builder):

- **Show updates** (default on) — render the per-item update timeline so visitors
  can follow progress. The maintenance widget now renders its timeline too
  (previously it fetched updates but didn't show them). Turning this off also
  skips the per-item detail fetch (a perf win).
- **Max updates per item** (default 3) — show only the latest N updates,
  most-recent first, so a chatty incident doesn't dominate the page.
- **Show recently resolved / completed** (default off) — include resolved
  incidents / completed maintenances, rendered in a separate "Recently resolved"
  / "Past maintenance" subsection below the active items.
- **Max age (days)** (default 7) — only include past items resolved/completed
  within the window.

Scoping and isolation are unchanged: still only the systems the operator bound,
still fail-closed when none are bound, still field-allow-listed DTOs (no
`createdBy`). The active/past partition + max-age + cap is a pure, unit-tested
helper (`selectEvents`).
