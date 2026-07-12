---
title: "Create your first team"
description: "Group users into a team, grant the team access to specific systems, and verify a non-admin member sees only what they should."
---

A team in Checkstack is a resource-scoped grant. Roles answer "what kinds of things may you do?"; teams answer "which specific resources may you do them to?". This walkthrough creates a team, adds members, grants the team access to a system and its dependent records, and then verifies a non-admin user inside that team sees only those resources.

For the full access model, read [Teams and access](/checkstack/user-guide/concepts/teams-and-access/).

## 1. Open the teams admin page

Open **Configuration -> Teams** from the sidebar. This is a standalone page gated on `auth.teams.read`, separate from the admin Auth Settings page - so team managers can reach it without platform-admin access (creating and deleting teams still requires an admin, but managing an existing team's members and managers does not).

The page lists existing teams with member count and manager flag. Click **Create Team**.

## 2. Create the team

Fill in the dialog:

- **Name** - a short, recognisable label, for example `Payments Squad`.
- **Description** - optional, but useful when you have many teams.

Click **Create**. The team appears in the list with zero members.

## 3. Add members

1. Find the team in the list and click the **people icon** in its Actions column to open the manage dialog.
2. In the **Members** section, type at least two characters into the search box to find a user or application by name or email (the directory search is restricted to team administrators).
3. Click a result to add them to the team immediately - there is no separate confirm step.
4. Optionally promote a member to **Manager** with the crown button next to them. Managers can edit the team itself (add/remove members, promote managers) without holding a global team-management role.

Repeat for each user you want in the team. The member count updates immediately.

> [!TIP]
> You can add external applications to teams too. Useful for scoping a CI pipeline's API key to a single set of systems instead of granting it a global role.

## 4. Grant the team access to resources

Team membership alone does not grant access. You have to attach the team to specific resources. There are three ways to do this:

### From the resource detail page (per-resource)

Most resources expose a **Who can change this** editor in their detail page:

1. Open a system's detail page from the **Catalog**.
2. In the sidebar, find the **Team Access** section and click its pencil - a focused **Team access** dialog opens. (Contacts, links, dependencies, and team access are all managed from the system page this way; the **Edit** dialog only carries the system's name, description, and custom fields.)
3. Click **Add a team that can change this**.
4. Pick the team. By default the team gets **Manage**: its members can view and change the resource, even members who do not hold the global permission, and anyone who could already read it still can. Untick **Manage** to make the grant read-only (members can view but not change it), or use the **Private** toggle to hide the resource from everyone outside the team.
5. The change saves immediately.

The same editor appears on health-check configurations, incidents, and maintenances. Every editable resource that supports team-scoped access exposes it the same way.

### From the Teams page (per-team)

Open **Configuration -> Teams**, click a team, and use the **Resource access** section to review everything the team can touch **by name**, change a grant's level, revoke it, or **add a new grant** by picking a resource type and searching for the resource. This is the best place for review, offboarding, or wiring one team across many resources. (Granting is an admin action.)

### Assign an owning team when creating a resource

Create forms (systems, health-check configurations, incidents, maintenances, SLO objectives, automations) show an **Owning team** picker. Choosing a team makes that team own the new resource (the team gets manage on it automatically); leaving it on **No team (global)** keeps the resource ungoverned by teams. A user who is not a global administrator can create a resource only for a team they belong to that has been granted creation rights for that resource type (see below). The new resource is **managed by the team, and its read access is unchanged** - team grants restrict who can change an object, not who can see it, so whoever could already read that resource type still can (read still requires the normal read permission for the type; it is not made world-readable). Mark it private only if you need to via the **Private** toggle in the "Who can change this" editor.

### Let a team create resources

Open a team (**Manage members**) and use the **Resource creation** section to allow that team's members to create specific resource types (e.g. health-check configurations, automations). This is the authority to create - distinct from membership - so a team used purely for grouping never gains create rights by accident.

For incidents and maintenances there is no separate toggle: **anyone who can manage a system may create incidents and maintenances for that system**. Scope a system to a team with `Manage` access and that team can open incidents/maintenances for it, while everyone keeps seeing them.

## 5. Verify the scoping

Sign out and sign back in as a non-admin user who is a member of the team.

What the user should see:

- The **Catalog** lists only systems they can reach via:
  - A role that grants the global `catalog.systems.read` rule (or the wildcard `*`).
  - A team grant on a specific system.
- Health-check configurations are filtered by their own team grant: the configuration list shows only those the user can reach via the global rule or a team grant.
- Incidents and maintenances follow the same model: their lists are filtered, and a user with team `read` on the resource sees it. (A caller with neither the global rule nor any team grant for a resource type gets a clear "not authorized" error rather than a silently empty list.)

What the user should NOT see:

- Systems they have no role-level rule for AND no team grant on.
- The **Settings** menu (no `auth.*.manage` rules from any role they hold).

> [!IMPORTANT]
> A user cannot self-elevate. The UI hides their own role checkboxes from edit, and the backend enforces the same rule. To add or remove a member's role assignments, an admin must do it from the Users tab.

## 6. Iterate

From here you can:

- Grant the team access to multiple systems at once from each system's detail page (or wire one team across many resources at once from **Configuration -> Teams**).
- Demote a manager back to regular member if their workflow changes.
- Delete the team to revoke every grant attached to it. Members retain any roles they hold from other sources.

> [!NOTE]
> Service-to-service plugin calls bypass team grants by design - they authenticate as a built-in service user. End users and external applications go through team checks every time.

## See also

- [Teams and access](/checkstack/user-guide/concepts/teams-and-access/) - mental model and how role rules interact with team grants.
- [Users and teams (developer)](/checkstack/developer-guide/architecture/users-and-teams/) - the internal access-control architecture.
- [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/) - SSO/LDAP group-to-role mapping that combines with team grants.
