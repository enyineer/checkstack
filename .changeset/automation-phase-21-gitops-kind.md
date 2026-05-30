---
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
---

Add the GitOps `Automation` entity kind (Wave 2 Phase 21).

- `automation-backend` registers an `Automation` kind with the GitOps entity-kind registry (`specSchema: AutomationDefinitionSchema`). Reconcile upserts by name (identity tracked via the returned entity id + provenance); reconciled rows are tagged `managed_by = "gitops"`. Delete is guarded to GitOps-managed rows. An automation's full definition - triggers (with `for:` dwells), structured conditions, the action catalog, mode, `concurrency_scope`, `uses_state`, `state_window_minutes` - can now be declared in Git.
- `automation-frontend`: the editor reads the GitOps provenance lock (`useProvenanceLock({ kind: "Automation", entityId })`) and, when locked, disables Save / Run-now / Delete and the form fields and shows a `GitOpsLockBanner`.
- Documented the `Automation` YAML format under the GitOps kinds reference, plus new automation platform overview + plugin-author ("extending") developer-guide pages.
