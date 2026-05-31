---
"@checkstack/automation-common": minor
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
---

Add grouping to automations so they are easier to find.

Each automation now carries an optional single free-text `group` label (HA-style "category"), stored as its own column on the `automations` row alongside `name` / `description` / `status` - it is NOT part of the definition / YAML. The automations list renders one collapsible section per group (sorted alphabetically, with an implicit "Ungrouped" bucket last), and the edit page gains a type-new-or-pick-existing group picker fed by the new `listAutomationGroups` query. `listAutomations` accepts an optional `group` filter.

Declaratively managed automations express their group via GitOps `metadata.labels.group`; the reconciler threads it onto the row (blank clears it).

A Drizzle migration adds the nullable `"group"` column and an index. Existing automations default to no group (Ungrouped) and behave exactly as before.
