---
"@checkstack/backend": minor
"@checkstack/backend-api": patch
"@checkstack/auth-backend": patch
"@checkstack/auth-common": patch
"@checkstack/auth-frontend": patch
---

Guard the role editor against granting inert (and misleading) permissions to the
anonymous role.

RPC procedures carry two independent axes: `userType` (the hard authentication
gate) and `access` rules (authorization). An admin can grant the anonymous role
any access rule, but if the procedures needing that rule are `userType:
"authenticated"`/`"user"`, the grant does nothing - the auth middleware rejects
unauthenticated callers BEFORE access rules are checked (so there is no security
hole; the grant is simply inert). After anonymous users started seeing
permission-gated UI, such a grant would surface as visible-but-broken controls.

- The backend now computes, from contract metadata, the access rules an anonymous
  caller can actually use (a rule is "usable" iff at least one `public` procedure
  requires it) via `pluginManager.getAnonymousUsableAccessRuleIds()`, exposed to
  plugins through the plugin environment.
- `auth.getAccessRules` annotates each rule with `anonymousUsable`.
- `auth.updateRole` REFUSES to ADD a non-usable rule to the anonymous role
  (existing grants are untouched, so no configuration can be wedged). This is a
  guardrail, not an enforcement change - RPC authorization is unchanged.
- The role editor disables non-usable rules (with an explanation) when editing
  the anonymous role.

Verified live: `getAccessRules` reports 11 anonymous-usable vs 58 not; granting
`incident.incident.manage` to the anonymous role returns HTTP 400 with a clear
message.
