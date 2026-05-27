---
title: "Users & Teams"
description: "How users, roles, and teams compose access control in Checkstack — RealUser vs ApplicationUser vs ServiceUser, how team grants flow through resource access checks, and the S2S endpoints other plugins should use to honour them."
---


Checkstack's access model is a small, three-axis composition:

- **Identity** — *who* is making the request (`RealUser`, `ApplicationUser`,
  or `ServiceUser`).
- **Roles** — coarse permission bundles built from access rules. A user can
  hold any number of roles; permissions union.
- **Teams** — resource-scoped grants. Membership in a team grants access to
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

`RealUser` and `ApplicationUser` are functionally similar — both carry an
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

1. **At creation** — the user-creation dialog
   ([`CreateUserDialog.tsx`](https://github.com/enyineer/checkstack/blob/main/core/auth-frontend/src/components/CreateUserDialog.tsx))
   surfaces a multi-select so admins can pick roles atomically with the
   create call. After `createCredentialUser` succeeds, the UI immediately
   calls `updateUserRoles` with the selected role IDs.
2. **Per row, post-create** — checkboxes in
   [`UsersTab.tsx`](https://github.com/enyineer/checkstack/blob/main/core/auth-frontend/src/components/UsersTab.tsx)
   toggle role assignment via `updateUserRoles`.

A user cannot modify their own role assignments — the UI disables their own
checkboxes and the backend enforces the same rule, preventing accidental
self-lockout or self-elevation.

## Teams: resource-scoped grants

Roles answer "what *kinds* of things may you do?". Teams answer "*which
resources* may you do them to?". A team holds:

- A set of member user / application IDs.
- A list of resource grants of shape
  `{ resourceType, resourceId, action: "read" | "manage" }`.

A user has access to a resource if either of the following is true:

1. They hold a role that includes the relevant *global* access rule
   (e.g. `catalog.systems.read` or `*`).
2. They are a member of a team that has a grant for that specific
   `(resourceType, resourceId, action)`.

Team management lives in
[`TeamsTab.tsx`](https://github.com/enyineer/checkstack/blob/main/core/auth-frontend/src/components/TeamsTab.tsx).

## S2S endpoints for resource access

Other plugins must not reimplement the team-grant logic. The auth backend
exposes two S2S endpoints (`userType: "service"`) for that purpose, declared
in
[`core/auth-common/src/rpc-contract.ts`](https://github.com/enyineer/checkstack/blob/main/core/auth-common/src/rpc-contract.ts):

### `checkResourceTeamAccess`

Input:

```ts
{
  userId: string;
  userType: "user" | "application";
  resourceType: string;
  resourceId: string;
  action: "read" | "manage";
  hasGlobalAccess: boolean;
}
```

Output: `{ hasAccess: boolean }`.

Call this on the **fast path** of an individual resource check — e.g. when
handling `getSystem(id)` and you need to decide whether the caller may see
this particular system. The `hasGlobalAccess` argument is the caller's
*role-based* verdict; the auth backend short-circuits to `true` if global
access is granted, otherwise it consults the team grants.

### `getAccessibleResourceIds`

Input:

```ts
{
  userId: string;
  userType: "user" | "application";
  resourceType: string;
  resourceIds: string[];
  action: "read" | "manage";
  hasGlobalAccess: boolean;
}
```

Output: `string[]` — the subset of `resourceIds` the user may access.

Use this on **list paths** where you need to filter a collection. The auth
backend issues a single SQL query rather than the N-way fanout you'd get
from looping `checkResourceTeamAccess`.

### When NOT to use them

- For `ServiceUser` callers — service identity bypasses team and role checks.
- For pure role checks unrelated to specific resources — those are handled
  by the `autoAuthMiddleware` declared `access:` array on each procedure;
  you don't need to call into auth-backend at all.

## Deferred to v1.1

The following are intentionally out of scope for v1.0 and tracked separately:

- **Audit logging** — there is no built-in audit log of role / team / grant
  changes. Plugins that need one today must roll their own.
- **User and team CSV export** — there is no built-in bulk export. The data
  is queryable via the existing list endpoints; bulk export is a UI
  ergonomic, not a missing capability.
- **Team-scoped resource-management UI** — today admins manage team grants
  from the Teams tab. A future enhancement will let resource owners
  (catalog, healthcheck, etc.) share their resources with a team directly
  from the resource detail page, without round-tripping through Auth
  settings.
- **Deletion side-effect handling** — orphan grants when a resource is
  deleted, cascade rules when a user leaves the system, and similar
  cleanup polish are tracked for v1.1. Current behaviour: callers must
  invoke `deleteResourceGrants` on the auth contract themselves when they
  delete a resource.
