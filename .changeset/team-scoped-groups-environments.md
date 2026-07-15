---
"@checkstack/common": minor
"@checkstack/backend-api": minor
"@checkstack/auth-common": minor
"@checkstack/auth-backend": minor
"@checkstack/auth-frontend": minor
"@checkstack/catalog-common": minor
"@checkstack/catalog-backend": minor
"@checkstack/catalog-frontend": minor
---

Catalog **Groups** and **Environments** are now team-manageable. Their reads
stay public (they are shared browse facets everyone can see), but creating,
renaming, and deleting them is team-scoped exactly like Systems: a create
writes an owning-team grant, and edit/delete require a per-instance manage
grant. A team that can create Systems can also create Groups and Environments
(and attach them to systems it manages) with no extra grant.

New reusable platform seam `instanceAccess.create.alsoAcceptCreatorOf: string[]`:
a create procedure can declare sibling types whose `creator` (create-capability)
grant also authorizes the create - strictly the type-level creator grant, so it
stays orthogonal to `create.parent` (which is instance-manage). It is backed by a
new strict-creator auth primitive `hasCreateCapability({ objectType })` consumed
by BOTH the create middleware and the frontend `canCreate` verdict (extended with
an optional `alsoAcceptCreatorOf`), so the button gate and the backend can never
drift. The boot conformance check now also verifies every `alsoAcceptCreatorOf`
type is a real team-scoped type, and `catalog.group` / `catalog.environment` gain
resource-name resolvers so their team grants render by name.

BREAKING: `catalog.deleteGroup` input reshaped from a bare `string` to
`{ id: string }` (mirrors the earlier `deleteSystem` reshape) so the per-group
manage check can resolve the target id. `catalog.reorderGroups` stays a
global-admin operation (it rewrites the single global sort order for all groups).
Existing ownerless (global) groups and environments remain editable only by
global catalog admins until re-owned; no data migration is required (team grants
live in the auth relation store).
