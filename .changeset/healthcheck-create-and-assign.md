---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
---

feat(healthcheck): atomically create and assign a health check in one step

Add a `createAndAssign` RPC that creates a health-check configuration and
assigns it to a system in a single transaction, so the common "one system, one
check" case can never leave a dormant, unassigned check that runs nothing. When
the assignment is enabled it is scheduled immediately, exactly like
`associateSystem`.

The AI `healthcheck.propose` tool now prefers the HTTP strategy for a URL
(instead of authoring a script health check) and, when given `assignToSystemId`,
creates, assigns, and starts the check in the same approval.

Also fixes a latent bug where the `associateSystem` handler silently dropped the
per-assignment `notificationPolicy` before it reached the database.
