---
"@checkstack/automation-frontend": minor
"@checkstack/automation-backend": minor
---

Show auto-generated trigger ids in the automation editor without clicking the field.

Previously, loading a stored definition (a seeded default, a GitOps-managed automation, or hand-written YAML) whose triggers carried no `id` left the Id field blank until the operator focused and blurred it. The editor now materializes the derived id eagerly on load - the same way the starter automation and "Add step" path already do - so the id is shown (and referenceable as `trigger.id`) immediately. The runtime already derived these ids, so saved definitions are unchanged.

The auto-incident migration also now writes explicit trigger ids (matching `deriveTriggerId(event)`) into the seeded sustained and flapping automations, so newly seeded defaults carry the same id the editor shows.
