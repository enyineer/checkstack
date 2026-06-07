---
"@checkstack/integration-common": minor
"@checkstack/integration-backend": minor
---

feat(integration): add user-callable listConnectionSummaries

`listConnections` is admin-gated (`integration.manage`) because it returns the
redacted config preview. Automation authors are not necessarily integration
admins, so they could not discover which `connectionId` to wire into an
integration action.

Add `listConnectionSummaries({ providerId })`, callable by any authenticated
principal, returning name-only `{ id, providerId, name }` (no config, no
secrets). The automation `listConnections` discovery tool and the propose-time
`connectionId` validation now use it, so a non-admin automation author gets real
connection ids (and real validation) instead of an empty/soft-degraded result.
