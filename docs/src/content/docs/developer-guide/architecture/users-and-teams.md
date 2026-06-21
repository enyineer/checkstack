---
title: "Users & Teams"
description: "How users, roles, and teams compose access control in Checkstack: RealUser vs ApplicationUser vs ServiceUser, how relation-tuple team grants flow through resource access checks, and the S2S endpoints other plugins should use to honour them."
---


Checkstack's access model is a small, three-axis composition:

- **Identity** - *who* is making the request (`RealUser`, `ApplicationUser`,
  or `ServiceUser`).
- **Roles** - coarse permission bundles built from access rules. A user can
  hold any number of roles; permissions union.
- **Teams** - resource-scoped grants. Membership in a team grants access to
  the specific resources the team owns, regardless of role.

The model lives entirely in `@checkstack/auth-backend`, with contracts in
[`@checkstack/auth-common`](https://github.com/enyineer/checkstack/blob/main/core/auth-common/src/rpc-contract.ts)
and the admin UI in
[`@checkstack/auth-frontend`](https://github.com/enyineer/checkstack/tree/main/core/auth-frontend).

## Identity: the three user types

All three types share a discriminated `AuthUser` union, defined in
[`core/backend-api/src/types.ts`](https://github.com/enyineer/checkstack/blob/main/core/backend-api/src/types.ts):

| Type             | Discriminator        | Carries roles / teams | Where it comes from                                                                  |
| ---------------- | -------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `RealUser`       | `type: "user"`       | Yes                   | Human login through any enabled `AuthStrategy` (credential, OIDC, etc.).             |
| `ApplicationUser`| `type: "application"`| Yes                   | API-key authentication for external machine clients. Configured under "Applications".|
| `ServiceUser`    | `type: "service"`    | No                    | Plugin-to-plugin (S2S) calls inside the platform. Trusted implicitly.                |

`ServiceUser` is the escape hatch for backend code: it bypasses role and team
checks entirely. Plugins authenticate as `ServiceUser` when calling another
plugin's S2S endpoints. Never expose a `ServiceUser` identity to anything
that crosses the trust boundary.

`RealUser` and `ApplicationUser` are functionally similar - both carry an
`accessRules` array, a `roles` array, and a `teamIds` array. The split exists
so admin UI surfaces can treat them separately (different lifecycle, different
listing tabs) and so policies that should only apply to humans (e.g.
"administrators only", "MFA required") can discriminate on `type`.

## Roles: access-rule bundles

A role is a named set of access rules. Access rules are flat string keys
plugins register at startup (e.g. `auth.users.manage`, `catalog.systems.read`).
The wildcard `"*"` grants everything and is reserved for the built-in
administrator role.

Roles are managed under the **Roles** tab in the admin UI
([`RolesTab.tsx`](https://github.com/enyineer/checkstack/blob/main/core/auth-frontend/src/components/RolesTab.tsx)):

- **System roles** (`isSystem: true`) cannot be deleted.
- **Anonymous-only roles** (`isAssignable: false`) are filtered out of the
  role assignment UI so admins cannot accidentally assign them to a person.

Users are assigned roles in two places:

1. **At creation** - the user-creation dialog
   ([`CreateUserDialog.tsx`](https://github.com/enyineer/checkstack/blob/main/core/auth-frontend/src/components/CreateUserDialog.tsx))
   surfaces a multi-select so admins can pick roles atomically with the
   create call. After `createCredentialUser` succeeds, the UI immediately
   calls `updateUserRoles` with the selected role IDs.
2. **Per row, post-create** - checkboxes in
   [`UsersTab.tsx`](https://github.com/enyineer/checkstack/blob/main/core/auth-frontend/src/components/UsersTab.tsx)
   toggle role assignment via `updateUserRoles`.

A user cannot modify their own role assignments - the UI disables their own
checkboxes and the backend enforces the same rule, preventing accidental
self-lockout or self-elevation.

## Teams: relation-tuple grants

Roles answer "what *kinds* of things may you do?". Teams answer "*which
resources* may you do them to?". The whole resource-access layer is a single
**relation-tuple store** (`relation_tuple`). Each row means
"`<subject>` has `<relation>` on `<object>`", where the object is
`{objectType}:{objectId}` (the qualified resource type plus the resource id, or
`*` for a type-level grant). A team holds:

- A set of member user / application IDs.
- `viewer` (read), `editor` (read + manage), or `owner` on a concrete object
  `{objectType}:{objectId}`. The implication is `owner` ⊃ `editor` ⊃ `viewer`,
  and at most one team owns an object.
- `creator` on the type-level object `{objectType}:*` - the authority to
  *create* resources of that type (distinct from membership; an admin grants it
  explicitly).

Privacy is a marker tuple, not a column. The special `public:*` subject with a
`private` relation, when present, closes the global RBAC path for that object
(team grants only); its absence (the default) keeps the object globally
readable. So a user has access to a resource when either of the following is
true:

1. The object has no team grants and is not private, and they hold a role that
   includes the relevant *global* access rule (e.g. `catalog.systems.read` or
   `*`). This is the default-open path most objects take.
2. They are a member of a team holding a relation that satisfies the action
   (read needs `viewer`/`editor`/`owner`; manage needs `editor`/`owner`).

The pure decision is `evaluateAccess` in
[`relation-tuple-store.ts`](https://github.com/enyineer/checkstack/blob/main/core/auth-backend/src/relation-tuple-store.ts).
Team management lives in
[`TeamsTab.tsx`](https://github.com/enyineer/checkstack/blob/main/core/auth-frontend/src/components/TeamsTab.tsx).

## S2S endpoints for resource access

Other plugins must not reimplement the relation-tuple logic. The auth backend
exposes a set of S2S procedures (`userType: "service"`) for it, declared in
[`core/auth-common/src/rpc-contract.ts`](https://github.com/enyineer/checkstack/blob/main/core/auth-common/src/rpc-contract.ts).
The full input/output shapes live in the
[Teams backend contract page](/checkstack/developer-guide/backend/teams/); this
section is the architectural map.

### Read checks

- **`check`** - decide access to a single object. Input is `{ userId, userType,
  objectType, objectId, action, hasGlobalAccess }`; output is
  `{ hasAccess: boolean }`. Call it on the **fast path** of an individual
  resource check (e.g. handling `getSystem(id)`). `hasGlobalAccess` is the
  caller's *role-based* verdict; the backend resolves it against the object's
  tuples via `evaluateAccess`.
- **`listAccessibleObjectIds`** - filter a collection. Input takes `objectIds:
  string[]`; output is the accessible subset. Use it on **list paths** so the
  backend resolves all candidates in one query rather than an N-way fanout.
- **`hasAnyTypeGrant`** - does the caller hold ANY grant of the required level
  on a concrete object of this type? List/record post-filters use it to return
  a meaningful `403` to a categorically-unauthorized caller instead of a
  silently-empty `200`.

### Create path

- **`authorizeCreate`** - decide whether a caller may create an object of
  `objectType` and which team should own it. It resolves the create matrix
  (global manage, team `creator` grant, or a parent-authorized create) and
  returns `{ ownerTeamId, isPrivate }`, or a `400 OWNER_TEAM_REQUIRED` /
  `403` when ownership is ambiguous or unauthorized.
- **`setOwner`** - record ownership after the row is persisted: the resolved
  team gets the `owner` relation, plus (unless `isPrivate`) the object stays
  globally readable.
- **`deleteObjectRelations`** - drop every tuple for a deleted object, so its
  grants do not outlive it. Call it from your delete handler.

### When NOT to use them

- For `ServiceUser` callers - service identity bypasses team and role checks.
- For pure role checks unrelated to specific resources - those are handled by
  the `autoAuthMiddleware` declared `access:` array on each procedure; you do
  not need to call into auth-backend at all.

## Deferred to v1.1

The following are intentionally out of scope for v1.0 and tracked separately:

- **Audit logging** - there is no built-in audit log of role / team / grant
  changes. Plugins that need one today must roll their own.
- **User and team CSV export** - there is no built-in bulk export. The data is
  queryable via the existing list endpoints; bulk export is a UI ergonomic, not
  a missing capability.
- **Team-scoped resource-management UI** - today admins manage team grants from
  the Teams tab. A future enhancement will let resource owners (catalog,
  healthcheck, etc.) share their resources with a team directly from the
  resource detail page, without round-tripping through Auth settings.
- **Deletion side-effect handling** - cascade rules when a user leaves the
  system and similar cleanup polish are tracked for v1.1. Current behaviour:
  callers must invoke `deleteObjectRelations` on the auth contract themselves
  when they delete a resource.
