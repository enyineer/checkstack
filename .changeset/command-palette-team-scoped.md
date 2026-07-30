---
"@checkstack/command-common": minor
"@checkstack/command-backend": minor
"@checkstack/command-frontend": minor
"@checkstack/incident-backend": patch
"@checkstack/maintenance-backend": patch
---

Show command-palette actions to team-scoped users

The palette filtered commands against the caller's GLOBAL access rules only, so a
user whose team holds a create-capability grant - but who holds no global
`incident.incident.manage` / `maintenance.maintenance.manage` rule - never saw
"Create Incident" or "Create Maintenance", nor their keyboard shortcuts. The
palette hid the actions from exactly the people authorized to run them.

Commands can now declare a `manageCapability` (mirroring the gate routes and nav
already use). `filterByAccessRules` shows an item when the caller holds the
global rules OR can create/manage the declared type through a team grant, and the
command backend resolves that per request via `hasAnyTypeGrant` (with
`includeCreator`, so a team member who may CREATE the type qualifies before
owning an instance). It fails closed: an auth error leaves pure global gating.
The incident and maintenance commands declare their types.

`useGlobalShortcuts` no longer takes `userAccessRules` and no longer re-checks
access: the server-filtered list is authoritative. That re-check tested the
global rules only and would have dropped team-scoped users' shortcuts - both call
sites already defeated it by passing `["*"]`.
