---
"@checkstack/incident-backend": patch
"@checkstack/auth-frontend": patch
---

Phase 12 of the v1 polishing plan: three coordinated cleanup items that
close out half-finished features ahead of v1.0.

`@checkstack/incident-backend` adds focused unit-test coverage for
`IncidentService.hasActiveIncidentWithSuppression` in
`core/incident-backend/src/service.test.ts`. The new tests exercise the
real query-builder logic against a programmable mock data source and
pin down the active-only silencing contract: returns `true` only when
an unresolved incident with `suppressNotifications=true` is associated
with the queried `systemId`; returns `false` for resolved incidents,
incidents with `suppressNotifications=false`, systems with no incident
associations, and other systems' silenced incidents. No runtime
changes; the service code was already correct end-to-end (write path
through `IncidentEditor`, read path through the healthcheck queue
executor and dependency notifications). A companion docs page,
`docs/src/content/docs/architecture/alert-silencing.md`, documents the
contract, the two read sites, and the dispatch paths silencing does
NOT cover so users aren't surprised when an unaware channel keeps
firing.

`@checkstack/auth-frontend` surfaces inline role assignment inside the
user-creation dialog so admins can pick role(s) atomically with the
create call. `CreateUserDialog` now renders a checkbox list of
assignable roles (those with `isAssignable !== false`); on submit,
`UsersTab` awaits `createCredentialUser`, then immediately calls
`updateUserRoles` with the selected role IDs. On partial failure
(user created, role assignment failed) the UI surfaces a warning toast
naming the recovery path rather than silently misreporting success. No
new endpoints — reuses the existing `createCredentialUser` +
`updateUserRoles` contract pair. A companion docs page,
`docs/src/content/docs/architecture/users-and-teams.md`, documents the
identity / role / team model, the two S2S endpoints
(`checkResourceTeamAccess`, `getAccessibleResourceIds`) other plugins
should call to honour team grants, and explicitly defers audit
logging, CSV export, team-scoped resource-management UI, and deletion
side-effect handling to v1.1.

The third item — deleting the empty `core/status-frontend/` and
`core/status-page-backend/` shells — is tooling-only and intentionally
ships without a changeset; neither shell had a `package.json`, source
file, or downstream importer.
