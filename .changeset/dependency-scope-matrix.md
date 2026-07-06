---
"@checkstack/dependency-common": minor
"@checkstack/dependency-backend": minor
"@checkstack/dependency-frontend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
---

Dependencies can now be scoped to a specific environment and/or health check of
the upstream system, each with its own severity - a "matrix" of scope cells.

Previously a dependency watched the upstream's overall health (any check, any
environment) at the edge's impact type, with optional per-check rules. That
default is unchanged: with no scope cells configured, the dependency behaves
exactly as before. Now each cell pins a check (a specific configuration, or
"any"), an environment (a specific environment, or "any"), and a severity
(informational / degraded / critical). When a dependency has any cells, only
those slices are watched (they replace the whole-system watch) and the worst
result across cells wins. This lets you express, e.g., "System A depends on
System B only in `prod`", or "only when B's TLS check in `prod` fails", and lets
different cells carry different severities.

Because each environment is evaluated on its own slice, a scoped dependency
catches an environment-specific outage that the upstream's overall status
(worst-wins across environments) would otherwise hide. The dependency evaluator
now reads per-(check, environment) health via a new
`@checkstack/healthcheck-common` bulk contract `getBulkSystemHealthMatrix` (and
its `@checkstack/healthcheck-backend` implementation), which returns each
system's cross-environment rollup plus a per-environment slice. Incident
overrides still fold into the overall rollup, so incident-forced statuses keep
propagating through dependencies.

The scope-cell store gains a nullable `environment_id` column and makes
`health_check_id` nullable (forward-only migration; existing rows keep working
as "any check, any environment"). The dependency editor's per-check panel
becomes a scope-matrix editor with check + environment + severity rows.

Transitive (multi-hop) dependencies still cascade using the upstream's overall
status; per-environment cascades across multiple hops are not yet propagated.
