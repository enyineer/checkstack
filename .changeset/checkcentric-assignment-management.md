---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
---

Relocate health-check assignment management from the catalog-entered,
system-centric Assignment IDE into the check editor itself, so a check's
settings AND its assignments (with their per-system settings) are managed in
one place. Users think in terms of "Health Checks", not the catalog - the
old flow was discovered through a catalog system row and inverted that mental
model.

- **Check editor Assignment section** (edit mode): lists every assigned
  system as a tree group with the per-assignment panels (General, Thresholds,
  Retention, Execution with satellites + environment fan-out, Notifications)
  plus an "Assign to system..." picker that only offers systems the caller
  can manage. The `AssignmentIDENodeSlot`/`AssignmentIDEPanelSlot` extension
  points keep their names and context shape - extension node ids are
  namespaced per system internally so config-keyed ids (e.g. the anomaly
  panels) no longer collide across systems.
- **New procedure `getConfigurationAssignments`** (config → systems, the
  inverse of `getSystemAssociations`), handler-authorized fail-closed: global
  configuration read or a team grant on the configuration sees every row;
  otherwise rows filter to systems the caller may read.
- **`getConfiguration` relaxed** (handler-authorized): a reader of an
  ASSIGNED system may load the (redacted) configuration - the same exposure
  `getSystemConfigurations` already allowed - so system managers can open the
  editor. Unauthorized callers still get the same `undefined` as a missing id.
- **RLAC**: the edit and config routes now declare
  `manageCapability.parentType: catalog.system`, so a pure system manager
  reaches the editor for its Assignment section; the config side renders
  read-only for them (Save disabled, strategies/collectors/access-control
  gated per-node) while their systems' assignment panels stay writable.
  GitOps-locked systems lock exactly their own assignment nodes.
- **Catalog wayfinding**: the per-system row button is now a
  "Manage health checks" link opening the Health Checks list pre-filtered to
  that system (`?system=<id>`); the filtered list loads via the
  system-read-gated `getSystemConfigurations`, so it also works for system
  managers without healthcheck grants.

BREAKING CHANGES: the standalone system-centric assignment page is removed -
the `healthcheck` plugin's `assignments` route (`/assignments/:systemId`) no
longer exists and `healthcheckRoutes.routes.assignments` is gone from
`@checkstack/healthcheck-common`. Deep links to the old page now 404; use the
check editor's Assignment section (or the filtered Health Checks list)
instead.
