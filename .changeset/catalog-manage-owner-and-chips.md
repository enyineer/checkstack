---
"@checkstack/ui": minor
"@checkstack/auth-common": minor
"@checkstack/auth-backend": minor
"@checkstack/auth-frontend": minor
"@checkstack/catalog-frontend": minor
---

Catalog manage tabs: per-row owner badge, de-bloated membership chips, and a
reusable batched ownership lookup.

- New batched auth primitive `listObjectRelationsBulk({ objectType, objectIds })`
  resolves the owning team(s) and privacy for MANY resources of one type in a
  single query (mirrors the per-object `listObjectRelations`). Backed by a new
  `RelationTupleStore.listObjectRelationsBulk`. This is the table-friendly
  counterpart any plugin can use to render an owner indicator per row without an
  N+1.
- New `@checkstack/auth-frontend` helpers built on it: `useResourcesManagedBy`
  (batched hook, gated on `auth.teams.read`) and the compact `ResourceOwnerBadge`
  presentational pill. The catalog Groups and Environments manage tabs now show a
  per-row "owned by <team>" badge and a one-line note that these are shared,
  globally-visible objects only the owning team can rename/delete.
- Membership chips on the Systems / Groups / Environments manage tabs collapse to
  a single count pill ("N systems") whose popover holds the members plus a
  name-sorted, searchable add list, instead of wrapping a full chip wall that
  made rows tall. Attaching/detaching a system to a group/environment is offered
  and enabled only for systems the caller can manage (matching the backend, which
  authorizes membership per `catalog.system` manage).
- Groups and Environments manage rows gain the same per-row "Scope to team"
  quick action Systems already had, so an owner can grant a team Manage/Read on a
  group or environment straight from the table. The action is a reusable
  `ScopeToTeamAction` (any team-scoped resource type) exported from
  `@checkstack/auth-frontend`; `ScopeSystemToTeamAction` is now a thin adapter
  over it. It self-gates on `auth.teams.manage` and defers mounting its dialog
  until first use.
- The Groups and Environments manage tabs gain row selection and a bulk-action
  bar, matching Systems: select the rows you manage, then bulk **Scope to team**
  (grant a team on many at once), bulk **Add system** (attach one system to every
  selected group/environment), or bulk **Delete**. Rows you cannot manage render
  a disabled checkbox and are excluded from "select all". The bulk scope button
  is a reusable `BulkScopeToTeamAction` exported from `@checkstack/auth-frontend`
  (the multi-select counterpart of `ScopeToTeamAction`); the systems bulk filler
  is now a thin adapter over it. Attaching a system to many environments is a
  single desired-set write, so the writes cannot race.
- Consistency polish across the three manage tabs: all row **Edit** actions now
  use the same pencil icon (Systems previously used a different one); **Groups**
  now edit through the same dialog editor as Systems and Environments (with a
  per-row Edit action) instead of an inline name field that had no matching Edit
  button; and the Systems **Health** column keeps its state badges on one row
  (side by side) instead of wrapping a second badge onto its own line.
- `@checkstack/ui` `DataTable` gains a per-column `truncate` option: the column
  absorbs the table's spare width and ellipsizes overflowing free-text (a long
  name/description) instead of letting one long value force the whole table to
  scroll horizontally. Cell content is vertically centered by default.
