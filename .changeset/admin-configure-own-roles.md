---
"@checkstack/auth-backend": patch
"@checkstack/auth-frontend": patch
---

Let platform admins configure roles they belong to. The self-role guard (you
cannot edit or delete the access rules of a role you currently have) exists to
prevent access elevation, but a wildcard (`*`) admin already holds every access
rule, so there is nothing to elevate - and the guard locked them out of
configuring roles they were automatically added to. `updateRole` and
`deleteRole` now exempt wildcard admins, and the role editor no longer disables
the access-rule checkboxes (or shows the self-lockout notice) for them. The
admin role itself stays non-editable (its access is the wildcard), and system
roles remain undeletable.
