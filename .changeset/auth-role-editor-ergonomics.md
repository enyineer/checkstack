---
"@checkstack/auth-frontend": minor
"@checkstack/common": minor
---

Role editor: alphabetised categories, bulk select, and role cloning

Access-rule categories in the role dialog are now sorted alphabetically (by their
rendered label, at both the category and the rule level) instead of following
plugin registration order, so a category can be found by scanning rather than by
reading the whole list.

Each category gained **Select all** / **Clear** actions. They respect the same
guards the individual checkboxes do - the anonymous role still cannot be granted
rules no public endpoint uses, and a locked role stays read-only.

Roles can be **cloned**: a new role seeded from an existing one's access rules,
saved as a create. The dialog now takes an explicit `mode` rather than inferring
"editing" from the presence of a role, which is what made the third state
expressible at all.

Adds a shared `buildClonedName` helper to `@checkstack/common` so every clone
affordance in the product produces the same name shape.
