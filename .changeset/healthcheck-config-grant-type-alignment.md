---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/auth-frontend": minor
---

Fix team-scoped health-check management being invisible. Health-check
configuration team grants are keyed on `healthcheck.healthcheck` (the RPC
middleware derives the grant key from the configuration access rule's
`resource`, and that rule is `accessPair("healthcheck", ...)`), but the frontend
capability gate, the route `manageCapability`, and the Teams grant-name resolver
all declared `healthcheck.configuration`. Because the two never matched, a user
who could manage a health check via a team grant (without the global manage
rule) saw none of the health-check management surfaces, and health-check grant
names did not resolve in the Teams admin UI.

`healthCheckResourceTypes.configuration` now resolves to `healthcheck.healthcheck`
(with a regression test pinning it to the middleware's grant key), the resolver
registers under the same type, and the create/edit/assignments routes gain the
`manageCapability` they were missing so team-scoped health-check managers (and,
for create/assign, system managers) can reach them. This is a non-breaking fix:
no stored access-rule id or grant key changes.
