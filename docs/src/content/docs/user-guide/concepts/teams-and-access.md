---
title: Teams and access
description: Users, roles, and teams compose Checkstack's access model. Roles answer "what may you do?", teams answer "to which resources?".
---

Checkstack's access model is built from three pieces: identity, roles, and teams. Identity says who is making a request. Roles bundle coarse permissions ("can manage users", "can read systems"). Teams scope those permissions to specific resources ("you may manage the Payment API system, but not the Identity API"). This page is the operator-level synthesis. For the wire-level contract see the developer-facing [Users and teams](/checkstack/developer-guide/architecture/users-and-teams/) doc.

## Who is making the request

Every request to Checkstack carries an identity, which is one of three types:

- **Real user.** A human who logged in through one of the configured authentication strategies (credential, SAML, LDAP, GitHub OAuth, ...). Carries roles and team memberships.
- **Application.** An API key for an external machine client. Also carries roles and team memberships. Configured under the Applications tab.
- **Service.** Plugin-to-plugin internal calls. Trusted implicitly and bypasses role and team checks. You will not see service identity in any UI; it is purely internal.

For everyday access decisions, "real user" and "application" behave identically. The split exists so admin surfaces can treat them separately (humans have a lifecycle, API keys have a rotation story).

> [!NOTE]
> See [API keys](/checkstack/user-guide/reference/api-keys/) for the application identity flow and how to issue, rotate, and revoke keys.

## Roles

A role is a named bundle of **access rules**. An access rule is a flat string key like `catalog.systems.read` or `auth.users.manage` that a plugin registers at startup. A role grants any number of access rules; permissions union when a user holds multiple roles.

Checkstack ships with these built-in roles:

| Role | What it covers |
|------|----------------|
| `admin` | Everything. Holds the wildcard `*` rule. Cannot be deleted. |
| `users` | The default authenticated user. Holds read-level access rules. |
| `anonymous` | Logged-out users. Used for public default access rules. |

You can create additional roles under **Infrastructure -> Auth -> Roles**. Roles you create are deletable and assignable. The built-in `anonymous` role is filtered out of the role-assignment UI so admins do not accidentally hand it to a person.

> [!TIP]
> Pick role granularity at the team-coordinator level. "Editor", "Viewer", "On-call manager" works well. Avoid one role per individual capability; that path leads to dozens of nearly-identical roles.

Users cannot modify their own role assignments. The backend enforces this even if a UI somewhere tried; it prevents accidental self-lockout or self-elevation.

## Teams

Roles answer "what kinds of things may you do?" Teams answer "which resources may you do them to?" A team carries:

- A list of **members**, by user or application ID.
- A list of **team managers**, who can manage membership and grants for that specific team without holding global admin.
- A list of **resource grants**, each of which says "this team may `read` or `manage` resource `<resourceType>/<resourceId>`".

A user has access to a resource when at least one of these is true:

1. They hold a role that includes the relevant **global** access rule (for example, `catalog.systems.read` or the wildcard `*`).
2. They are a member of a team that has a grant for that specific resource.

In other words: roles let you cut access "wide" (everyone can read everything), teams let you cut access "narrow" (only the Payments team can manage the Payment API system).

> [!IMPORTANT]
> Resources you mark **team-only** opt out of the global path entirely. A team-only system requires team membership; even a user with the global `catalog.systems.read` rule cannot see it unless they are on a team with a grant for it. Use this for sensitive systems.

## Admin vs member

Two practical distinctions you will hit:

- **Platform admins** (users with the `admin` role) can do anything. They manage users, roles, teams, and resource access settings across the whole platform.
- **Team managers** (users in a team's `team_manager` list) can manage that specific team's membership and grants. They cannot touch other teams or do platform-wide admin work.

This is the usual delegation pattern: a small number of platform admins, and per-team managers who run their own corner.

## How resource access is enforced

When a plugin needs to know whether the current user can see a particular resource, it does not reimplement team-grant logic. The auth backend exposes two service-to-service endpoints that every other plugin uses:

- `checkResourceTeamAccess` for fast-path single-resource decisions ("can this user see system X?").
- `getAccessibleResourceIds` for list paths ("of these system IDs, which ones can this user see?").

Both take a `hasGlobalAccess` argument (the caller's role-based verdict). If global access is granted, the backend returns true. Otherwise it consults team grants in a single query.

This means consistency: every plugin that respects team access uses the same engine. If you grant a team manage access on a system, the catalog UI, the health-check UI, the dependency map, and any third-party plugin that integrates correctly all honour it.

## Common configurations

A few patterns that show up often:

- **Open read, locked write.** Default: `users` role has `*.read` rules; managing anything requires admin. Everyone sees everything; only admins change it.
- **Per-team ownership.** Default users have global read. Manage access is granted via teams that own specific systems (Payments team owns Payment API, etc.).
- **Tight read scoping.** Some systems are marked team-only. Default users do not see them; only their team does. Useful for compliance-sensitive systems.

## UI tour

| Where to go | What you do there |
|-------------|-------------------|
| **Infrastructure -> Auth -> Users** | Add users (credential auth), assign roles, deactivate. |
| **Infrastructure -> Auth -> Roles** | Create and edit roles, manage their access-rule lists. |
| **Infrastructure -> Auth -> Teams** | Create teams, set membership, assign team managers, add resource grants. |
| **Infrastructure -> Auth -> Applications** | Issue API keys, assign them roles and team memberships. |
| **System detail -> Access** | Grant a team access to this specific system (team manager view). |

## Deferred for later

A few things are intentionally out of scope for the current release and tracked separately:

- **Audit log.** Checkstack does not yet ship a built-in audit log of role/team/grant changes.
- **CSV exports.** Bulk export of users and teams is not built in; the data is queryable via the API.
- **Resource-side team UI.** Today, team grants are managed from the Teams tab. A future enhancement will let resource owners share their resources to a team directly from the resource detail page without round-tripping through Auth settings.

## Where to go next

- **Hands-on.** Walk through [Create your first team](/checkstack/user-guide/guides/create-a-team/).
- **API keys.** [API keys](/checkstack/user-guide/reference/api-keys/) covers application identities.
- **Authentication strategies.** [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/) covers SSO, SAML, LDAP, and friends.
- **SAML/LDAP setup.** [Configure SAML SSO](/checkstack/user-guide/guides/configure-saml-sso/) and [Configure LDAP](/checkstack/user-guide/guides/configure-ldap/).
