---
"@checkstack/slo-backend": minor
---

Add a GitOps `SLO` kind so reliability targets can be declared in YAML.

The kind references its target system via `systemRef` and may optionally
narrow to a single healthcheck via `healthcheckRef`. Excluded
dependencies are referenced by ref and resolved to system IDs at
reconcile time.

```yaml
apiVersion: checkstack.io/v1alpha1
kind: SLO
metadata:
  name: payments-availability
spec:
  systemRef: { kind: System, name: payments-api }
  target: 99.9
  windowDays: 30
```

Reconcile maps to `SloService.createObjective` /
`updateObjective` / `deleteObjective`; the entity ID stored in
provenance is the SLO objective UUID, so renames in YAML preserve
identity.
