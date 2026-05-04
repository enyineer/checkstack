---
"@checkstack/dependency-backend": minor
"@checkstack/dependency-frontend": minor
---

Add a GitOps `System.dependencies` extension and lock the matching UI.

Each entry references an upstream system by ref and tunes the impact:

```yaml
apiVersion: checkstack.io/v1alpha1
kind: System
metadata: { name: payments-api }
spec:
  dependencies:
    - targetRef: { kind: System, name: payments-db }
      impactType: critical
      transitive: false
      label: "primary store"
```

The reconciler diffs the YAML-declared edges against the persisted ones
where this system is the source and converges via
create / update / delete. GitOps is the source of truth, so any edges
no longer listed are removed. Refs that resolve to the source system
itself are rejected; refs that fail to resolve abort the diff before
any mutation.

UI gates:

- The `DependencyEditor` (system editor drawer) hides Add and disables
  Edit/Delete on upstream rows when the source system is GitOps-managed.
  Downstream rows are gated per-row by the *other* system's lock.
- The `DependencyMap` blocks `onConnect` when the source is locked,
  surfaces a "Managed by GitOps" notice in the edge editor panel, and
  disables Save/Delete there.
