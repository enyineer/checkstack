---
"@checkstack/auth-frontend": minor
---

Clarify the team-access editor and guard against locking yourself out

Four fixes to the "Who can change this" editor and the team member picker, from
user feedback:

- **The "Manage" checkbox read as "manage the team".** It sets the selected
  team's grant on THIS resource, but the label plus a gear icon suggested it
  would open the team itself. It is now labelled **"Can edit"** (with no gear),
  naming its effect on the resource.
- **The team name is now a link** to that team (`/teams?team=<id>`), which opens
  its members dialog directly. That gives "take me to the team" its own
  affordance instead of overloading the checkbox. The Teams page consumes the
  `team` query param once and then clears it.
- **Revoking your own team's access now asks first.** A team-scoped user could
  remove (or downgrade) their own team's only edit grant and afterwards be unable
  to change the resource *or* restore the permission. That case now shows a
  confirmation explaining the consequence. Global `auth.teams.manage` admins are
  not warned - they can always restore it. The decision is a pure, unit-tested
  `isSelfRevokingChange`.
- **The add-member field explained.** Its placeholder ("Add a user by name or
  email") and new helper text state that it adds a NEW member from the whole
  directory rather than filtering current members, and that a user is only
  findable after their first sign-in (SSO/LDAP accounts materialise on login).
