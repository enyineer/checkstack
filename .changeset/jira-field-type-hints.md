---
"@checkstack/integration-jira-backend": patch
"@checkstack/integration-jira-common": patch
---

Surface each Jira field's value TYPE in the `create_issue` additional-fields
option list (`fieldOptions`), via the option's `description` — e.g. `labels` is
shown as "array of string", a story-points field as "number", and a select as
"option; one of: …". Previously the resolver returned only the field key + name,
so the model (and the editor) knew the field but had to guess the value shape and
would, for example, send a bare string for an array-typed field like `labels`.
The field's `schema.items` (array element type) is now also captured.
