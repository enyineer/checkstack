---
"@checkstack/auth-backend": minor
"@checkstack/auth-common": minor
"@checkstack/auth-frontend": minor
"@checkstack/frontend": minor
"@checkstack/frontend-api": minor
---

Let team members and managers see and manage their own team without a global rule

Opening the "Who can change this" team-access modal (e.g. on a system) as a
team manager failed with "Couldn't load team access. Retry or reopen the
editor.", because the backend 403'd `getTeams` and denied `listObjectRelations`.
The team-read procedures were gated on the GLOBAL `auth.teams.read` rule, which
a team-scoped user (a per-team ReBAC grant, no global rule) does not hold - so
managers and members were locked out of their own team, and managers who tried
to add / remove / promote members would have been 403'd too.

The read/metadata procedures (`getTeams`, `getTeam`, `listObjectRelations`,
`listObjectRelationsBulk`, `listSubjectRelations`, `listTeamCreateGrants`,
`searchUsers`, `resolveResourceNames`, `getResourceKinds`) are no longer gated
on the global rule. Each now scopes in the handler:

- A caller holding global `auth.teams.read` (or a trusted service) still sees
  every team.
- Everyone else sees ONLY the team(s) they are a member or manager of.
  `getTeams` returns just those teams, `getTeam` returns `undefined` for a team
  the caller has no stake in (no existence leak), and `listObjectRelations` /
  `listObjectRelationsBulk` hide an object's team grants from a caller with no
  stake while still returning the public flag - a successful, empty response,
  never a 403.
- `searchUsers` keeps its own guard: the directory is still searchable only by a
  global team-manager or a manager of at least one team.

Team WRITE procedures (`updateTeam`, `addUserToTeam`, `removeUserFromTeam`,
`addTeamManager`, `removeTeamManager`) already enforced
`assertTeamManagementAccess` (service, global `teams.manage`, or manager of the
specific team) and now pass the middleware so a team manager can actually manage
their own team. Creating and deleting whole teams stays admin-only
(`auth.teams.manage`).

Frontend: the standalone Teams page and its nav entry are now shown to a global
`auth.teams.read` holder OR any user who is a member/manager of at least one
team - not unconditionally to every authenticated user, and no longer requiring
the global rule. A user in no team (and holding no global rule) does not see it.
This is driven by a new `isInAnyTeam` flag on the app-wide `accessRules` query
(member OR manager, so manager-only teams count), threaded into the sidebar's
nav-visibility model and exposed to every route's `isVisible` predicate via a
new `isInAnyTeam` context field (`@checkstack/frontend-api`). The page
self-scopes via the now-scoped `getTeams`, and per-team management affordances
stay gated on managing that team.

BREAKING CHANGE: `auth.teams.read` no longer gates the team read procedures at
the middleware. If you relied on that rule to hide team existence from
authenticated users, note that a user now sees the teams they belong to
regardless; access to a specific team's data is still limited to its
members/managers or a global-rule holder.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
