---
"@checkstack/healthcheck-backend": minor
"@checkstack/incident-backend": minor
"@checkstack/maintenance-backend": minor
"@checkstack/dependency-backend": minor
"@checkstack/catalog-common": minor
"@checkstack/catalog-backend": minor
---

### Notification System Optimizations

**System context in notifications**: All notification senders (healthcheck, incident, maintenance, dependency) now include the affected system name in the notification title and body. Users can immediately identify which system is affected without clicking through to the detail page.

**Upstream notification deduplication**: When an upstream dependency goes down affecting multiple downstream systems, the dependency notification sidecar now sends **one personalized notification per user** instead of one notification per affected system. Each user's notification lists only the systems they are subscribed to, with a link to the upstream root cause system. This prevents notification floods for users subscribed to groups containing many dependent systems.

**New catalog endpoint**: Added `getSystemGroupIds` S2S RPC endpoint on the catalog to resolve which catalog groups contain a given system, used by the dependency plugin for efficient subscriber resolution during batched notification dispatch.
