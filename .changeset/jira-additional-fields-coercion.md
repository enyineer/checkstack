---
"@checkstack/integration-jira-backend": patch
---

Coerce and validate `create_issue` field mappings against the live Jira field
schema. The mapping value is always a config string, but Jira fields are typed,
so the action now fetches the project+issue-type field metadata and converts each
value to the shape Jira expects: `labels` (array of string) becomes a real array,
a number field becomes a number, a select maps to `{ id }` from its allowed
values, etc. It also VALIDATES up front — an unknown field key or an option value
outside the field's allowed set fails the step with a clear message instead of an
opaque Jira 400. Scalar fields were already fine; array/object/option fields now
work.
