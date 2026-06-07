---
"@checkstack/dependency-backend": minor
"@checkstack/dependency-common": minor
"@checkstack/dependency-frontend": patch
---

feat(dependency): contribute dependency warnings to the backend system.issues aggregator

The dependency plugin now registers a `system.issues` contributor (sourceId
`dependency`) from its backend `init`, so the AI assistant surfaces upstream
dependency problems alongside incidents, SLOs, health checks, and anomalies.

The contributor enforces its own `dependency.read` access gate (returning an
empty map - never throwing - when the principal lacks access; service users are
trusted), then evaluates dependency warnings for every system that participates
in a dependency edge by reading the shared, durable `dependencies` table. The
answer is therefore identical on every pod. Only systems with an actual warning
appear in the result.

The row->signal mapping (source/tone/label/detail/href/accessRule/iconName) is
extracted into a new pure `deriveDependencySignals` deriver in
`@checkstack/dependency-common`, shared by both the backend contributor and the
frontend `DependencySignalsFiller` so the two surfaces stay in lockstep. The
frontend filler now delegates to that deriver with unchanged behavior.
