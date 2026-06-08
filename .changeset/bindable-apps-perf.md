---
"@checkstack/auth-backend": patch
"@checkstack/auth-common": patch
"@checkstack/automation-backend": patch
---

Fix a performance regression in `getBindableApplications`: it resolved every
application's effective access rules with 3-4 queries per application on every
call, which the AI propose / service-account flow hits on each chat turn,
showing up as broad slowness on the shared database. Rule resolution is now
batched into a fixed number of queries regardless of how many applications
exist, and an admin (`*`) caller that does not need the rules (the editor's
"Run as" picker) skips resolution entirely. The query gains an optional
`includeAccessRules` input (default off); `accessRules` is returned only when
requested.
