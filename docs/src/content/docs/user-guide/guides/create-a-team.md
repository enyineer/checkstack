---
title: "Create your first team"
description: "Group users into a team, grant the team access to specific systems, and verify a non-admin member sees only what they should."
---

A team in Checkstack is a resource-scoped grant. Roles answer "what kinds of things may you do?"; teams answer "which specific resources may you do them to?". This walkthrough creates a team, adds members, grants the team access to a system and its dependent records, and then verifies a non-admin user inside that team sees only those resources.

For the full access model, read [Teams and access](/checkstack/user-guide/concepts/teams-and-access/).

## 1. Open the teams admin page

Sign in as an administrator. From the user menu, open **Settings -> Users & Teams** and click the **Teams** tab.

The page lists existing teams with member count and manager flag. Click **Create Team**.

## 2. Create the team

Fill in the dialog:

- **Name** - a short, recognisable label, for example `Payments Squad`.
- **Description** - optional, but useful when you have many teams.

Click **Create**. The team appears in the list with zero members.

## 3. Add members

1. Find the team in the list and click the row to open the **Members** dialog.
2. Click **Add Member**.
3. Pick a user from the dropdown. The dropdown lists every real user and external application registered in Checkstack.
4. Optionally promote the member to **Manager**. Managers can edit the team itself (add/remove members, edit grants) without holding a global team-management role.
5. Click **Add**.

Repeat for each user you want in the team. The member count badge updates immediately.

> [!TIP]
> You can add external applications to teams too. Useful for scoping a CI pipeline's API key to a single set of systems instead of granting it a global role.

## 4. Grant the team access to resources

Team membership alone does not grant access. You have to attach the team to specific resources. There are two ways to do this:

### From the resource detail page (per-resource)

Most resources expose a **Team access** editor in their detail page:

1. Open a system from the **Catalog**.
2. Scroll to the **Team access** section in the system editor (or open the system editor by clicking **Edit**).
3. Click **Add team grant**.
4. Pick the team and the action level:
   - **Read** - team members can view the system, its health checks, and its history.
   - **Manage** - team members can edit the system, add/remove checks, edit assignments, and so on.
5. Click **Save**.

The same `Team access` editor appears on incidents, maintenances, and notification subscriptions. Every editable resource that supports team-scoped access exposes it the same way.

### From the team page (bulk)

If you have many resources to grant in one go, open the team and use the **Resource grants** tab to attach grants from a single screen.

## 5. Verify the scoping

Sign out and sign back in as a non-admin user who is a member of the team.

What the user should see:

- The **Catalog** lists only systems they can reach via:
  - A role that grants the global `catalog.systems.read` rule (or the wildcard `*`).
  - A team grant on a specific system.
- Health checks under those systems are visible. Health checks on systems the user has no grant for are filtered out of the listing.
- Incidents and maintenances follow the same model: if the user has team `read` on the resource, they see it.

What the user should NOT see:

- Systems they have no role-level rule for AND no team grant on.
- The **Settings** menu (no `auth.*.manage` rules from any role they hold).

> [!IMPORTANT]
> A user cannot self-elevate. The UI hides their own role checkboxes from edit, and the backend enforces the same rule. To add or remove a member's role assignments, an admin must do it from the Users tab.

## 6. Iterate

From here you can:

- Grant the team access to multiple systems at once by opening each system editor.
- Demote a manager back to regular member if their workflow changes.
- Delete the team to revoke every grant attached to it. Members retain any roles they hold from other sources.

> [!NOTE]
> Service-to-service plugin calls bypass team grants by design - they authenticate as a built-in service user. End users and external applications go through team checks every time.

## See also

- [Teams and access](/checkstack/user-guide/concepts/teams-and-access/) - mental model and how role rules interact with team grants.
- [Users and teams (developer)](/checkstack/developer-guide/architecture/users-and-teams/) - the internal access-control architecture.
- [Authentication strategies](/checkstack/user-guide/reference/authentication-strategies/) - SSO/LDAP group-to-role mapping that combines with team grants.
