---
"@checkstack/frontend-api": minor
---

Add `auditManageCapabilities`, a pure RLAC drift auditor. Given the plugins and
the set of backend-team-scopable resource types, it returns every management
route/nav entry that is gated on a team-scopable `manage` rule but is missing (or
mis-declares) its `manageCapability` - the class of bug where a team-scoped user
can act per the backend but never sees the surface. A new CI check
(`bun run check:manage-capabilities`) derives the team-scopable types from the
backend contracts' `instanceAccess` (mirroring the RPC middleware's grant keying)
and runs the auditor over the real plugins, failing when frontend gating drifts
from the backend authorization contract.
