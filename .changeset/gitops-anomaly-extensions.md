---
"@checkstack/anomaly-backend": minor
---

Add GitOps extensions for declarative anomaly configuration.

Two extensions are now registered against the kind registry:

- `Healthcheck.anomaly` — accepts the full `AnomalySettings` shape and
  applies it to the healthcheck's anomaly template via
  `updateAnomalyConfig` on reconcile.
- `System.anomaly` — accepts an array of per-healthcheck overrides,
  each scoped via `healthcheckRef: { kind: Healthcheck, name: ... }`,
  and applies them with `updateAnomalyAssignmentConfig`. The
  healthcheck reference is the GitOps source of truth; UI edits to
  managed entries are blocked by the existing assignment-level lock.

Spec schema documentation for `Healthcheck.anomaly.fieldOverrides` is
registered **per collector field**, conditioned on the selected
`collectors[].config` variant — same pattern the `collectors[].assertions`
docs use, so the kind-registry browser pre-populates the available
result fields once a collector is chosen. The System extension's
`fieldOverrides` falls back to a generic variant since the relevant
collector lives on the referenced Healthcheck rather than a sibling.
