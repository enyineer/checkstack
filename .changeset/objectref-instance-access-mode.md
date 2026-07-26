---
"@checkstack/common": minor
"@checkstack/backend-api": minor
"@checkstack/backend": patch
"@checkstack/auth-common": minor
"@checkstack/auth-backend": minor
---

Add the `objectRef` instanceAccess mode and move the relation-write authz onto it

The relation-tuple writes (`writeRelation` / `removeRelation` / `setObjectPublic`)
administer team access on ANY resource type, so their authorization could not be
expressed by the existing `instanceAccess` modes (which all assume a fixed
resource type) and was enforced by hand in the auth handlers with `access: []` -
leaving the contract unable to declare the rule and the API docs showing no
restriction.

A new `objectRef` mode reads the object's TYPE and id from the request body
(`typeParam` / `idParam`) and authorizes via the same engine native scoping uses:
the endpoint's own access rule (`auth.teams.manage`) is the global admin
OR-override, otherwise the caller must be able to manage the referenced object
(its own `<type>.manage` rule on a non-private object, or a team editor/owner
grant on it). `autoAuthMiddleware` enforces it, the boot validator recognises it
(input paths cross-checked), and the auth handlers drop their hand-rolled checks.
Behaviour is unchanged; the authorization is now contract-declared and enforced
by the middleware rather than the handler.
