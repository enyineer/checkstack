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
- A list of **team managers**, who can manage that team's membership and managers without holding global admin (granting the team access to resources stays an admin action - see the permissions table below).
- A list of **resource grants**, each of which says "this team may `read` or `manage` resource `<resourceType>/<resourceId>`".

A user has access to a resource when at least one of these is true:

1. They hold a role that includes the relevant **global** access rule (for example, `catalog.systems.read` or the wildcard `*`).
2. They are a member of a team that has a grant for that specific resource.

In other words: roles let you cut access "wide" (everyone can read everything), teams let you cut access "narrow" (only the Payments team can manage the Payment API system).

> [!IMPORTANT]
> Resources you mark **team-only** opt out of the global path entirely. A team-only system requires team membership; even a user with the global `catalog.systems.read` rule cannot see it unless they are on a team with a grant for it. Use this for sensitive systems.

> [!NOTE]
> Team-only is enforced on the resource you set it on. A system's sub-records (its health checks, contacts, and links) are gated by the **system's** access, so making the system team-only also hides them. Marking a sub-record team-only on its own does not hide it behind a system that everyone can still read - lock down the parent system instead.

## Admin vs member

Two practical distinctions you will hit:

- **Platform admins** (users with the `admin` role) can do anything. They manage users, roles, teams, and resource access settings across the whole platform.
- **Team managers** (users in a team's `team_manager` list) can manage that specific team's **membership and managers**. They cannot touch other teams, grant the team access to resources, or do platform-wide admin work.

This is the usual delegation pattern: a small number of platform admins, and per-team managers who run their own corner.

## Who can do what (permissions)

Every team-related action maps to an access rule (granted via a role) and, for some actions, to being a manager of the specific team. "Admin" below means holding `auth.teams.manage` (the `admin` role has it).

| Action | What you need |
|--------|---------------|
| View ALL teams (and "who can change this" on any resource) | `auth.teams.read` |
| View your OWN team(s) and their members | be a member or manager of the team (no global rule needed) |
| Create a team | `auth.teams.manage` (admin) |
| Delete a team | `auth.teams.manage` (admin) |
| Rename / edit a team's details | be a manager of that team (or `auth.teams.manage`) |
| Add / remove team members | be a manager of that team (or `auth.teams.manage`) |
| Promote / demote team managers | be a manager of that team (or `auth.teams.manage`) |
| Grant or revoke a team's access to a resource (the **Team access** editor, **Scope to team**) | **manage** on that resource: `auth.teams.manage` (admin), the resource's own `<plugin>.<resource>.manage` rule, or membership of a team that already **manages** (editor/owner) that resource. A team that only **reads** it, or has no grant, is read-only and cannot elevate. The first grant on an otherwise-unscoped resource still needs one of the global rules. |
| Make a resource **team-only** (private) | Same **manage-on-the-resource** rule as granting access |
| Allow a team to **create** a resource type (create-capability) | `auth.teams.manage` |
| Create a resource **owned by a team** | one of: the global `<plugin>.<resource>.manage` rule; membership of a team that has a create-capability grant for that type; a create-capability grant on a **sibling** type (e.g. a team that may create Systems may also create catalog Groups and Environments); or (incidents/maintenances) manage access to the target system |

Key takeaways:

- **Team managers** are about running a team (members + managers). Handing out a team's access to a *specific* resource is delegated to whoever can **manage that resource**: a global `auth.teams.manage` admin, a holder of the resource's own manage rule, or a member of a team that already manages it. So a team that manages a system can add or remove other teams on that system and choose whether they manage it, without platform-admin - but a read-only team cannot, and cannot elevate itself. Granting a team the standing right to **create** a resource type is still an admin (`auth.teams.manage`) action.
- **Reading** is scoped, not all-or-nothing: `auth.teams.read` lets you see *every* team and what manages any resource, but even without it a team member or manager always sees *their own* team(s) and can open the Teams page to run them. Read of the resources themselves stays global unless the resource is marked team-only. Catalog **Groups** and **Environments** follow this: everyone still sees them (they are shared organizing labels), but creating, renaming, and deleting them is team-scoped.
- **Creating** a team-owned resource has four independent paths (global manage, a per-type create grant, a sibling-type create grant, or managing the parent system) - a user needs only one of them. The sibling path is what lets a team that can create Systems also create the Groups and Environments those systems belong to, without a separate grant.

## How resource access is enforced

When a plugin needs to know whether the current user can see a particular resource, it does not reimplement team-grant logic. The auth backend exposes two service-to-service endpoints that every other plugin uses:

- A single-resource access check for fast-path decisions ("can this user see system X?").
- A list filter for list paths ("of these system IDs, which ones can this user see?").

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
| **Configuration -> Auth Settings -> Users** | Add users (credential auth), assign roles, deactivate. (Admin.) |
| **Configuration -> Auth Settings -> Roles** | Create and edit roles, manage their access-rule lists. (Admin.) |
| **Configuration -> Teams** | A standalone page (**not** part of admin Auth Settings), shown to `auth.teams.read` holders and to anyone who is a member or manager of at least one team: it lists the teams you can see - every team with `auth.teams.read`, otherwise just the ones you belong to or manage. Create teams (admin), manage a team's members and managers (a team's own managers can do this), search the directory to add members, and (admin) review/edit/revoke/add the team's resource grants **by name**. |
| **Configuration -> Auth Settings -> Applications** | Issue API keys, assign them roles and team memberships. (Admin.) |
| **Resource detail -> Who can change this** | See who can change a resource (and the people by name), and (admin) grant a team access to it. The same editor appears on systems, health-check configurations, incidents, and maintenances. |

## Two ways to manage grants

There are two complementary places to wire teams to resources, and they share one engine:

- **From the resource** ("Who can change this" editor on a system / health-check / incident / maintenance): scope *this* resource to one or more teams. Best when you are already looking at the resource.
- **From the team** (Teams page): review everything a team can touch **by name**, change a grant's level, revoke it, or add a new grant by searching for a resource. Best for review, offboarding, or setting a team up across many resources at once.

Create forms also expose an **Owning team** picker to assign a new resource to a team at creation time.

## Deferred for later

A few things are intentionally out of scope for the current release and tracked separately:

- **Audit log.** Checkstack does not yet ship a built-in audit log of role/team/grant changes.
- **CSV exports.** Bulk export of users and teams is not built in; the data is queryable via the API.
- **SLO objective labels.** SLO objectives have no human-readable name, so in the Teams grant list they show the owning system id rather than a friendly label.
- **Health-check "who can change this" reach.** The read-only access indicator on a health-check configuration currently lives on the configuration detail page, which is gated on `healthcheck.configuration.manage`. So it is visible to people who can already manage the check, not to a read-only viewer wanting to know who to ask. The system, incident, and maintenance indicators sit on read-accessible pages and do not have this limitation; surfacing the health-check one on a read-level view is a follow-up.

## Where to go next

- **Hands-on.** Walk through [Create your first team](/checkstack/user-guide/guides/create-a-team/).
- **API keys.** [API keys](/checkstack/user-guide/reference/api-keys/) covers application identities.
- **Authentication strategies.** [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/) covers SSO, SAML, LDAP, and friends.
- **SAML/LDAP setup.** [Configure SAML SSO](/checkstack/user-guide/guides/configure-saml-sso/) and [Configure LDAP](/checkstack/user-guide/guides/configure-ldap/).
