---
"@checkstack/catalog-frontend": patch
---

Let groups and environments be scoped to multiple teams and un-scoped again. The
Group and Environment edit dialogs now embed the full `TeamAccessEditor` (the
same control systems use on their detail page) when editing an existing
group/environment, so you can add any number of teams, remove a team, toggle a
team between Manage and Read-only, and flip privacy. Previously the only
team-scoping surfaces for groups/environments were the create-time single owner
picker and the additive per-row "Scope to team" action, so a group/environment
could effectively only be handed to one team and never un-scoped. No backend
change: the generic relation endpoints already supported this; the editors just
never exposed it.
