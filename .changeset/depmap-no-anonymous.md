---
"@checkstack/dependency-common": minor
---

Make the dependency map authenticated-only by construction. `getAllDependencies`
moves from `userType: "public"` to `"authenticated"`, so no map-gated procedure
is public anymore and `dependency.map.read` drops out of the anonymous-usable
rule set - the role editor and auth-backend now refuse to grant it to the
anonymous role. This removes the previously documented option of exposing the
full topology map to anonymous visitors (per-system dependency warnings stay on
the public `dependency.dependency.read` rule) and eliminates the guest 401s
from the map page's `getNodePositions` (`userType: "user"`) call, which anonymous
visitors could otherwise trigger.

BREAKING CHANGE: an existing `dependency.map.read` grant on the anonymous role
becomes inert (guests are rejected by the auth middleware before access rules
are consulted); the dependency map is now always a signed-in surface.
