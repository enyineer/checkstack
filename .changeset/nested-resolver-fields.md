---
"@checkstack/automation-backend": minor
---

The AI assistant can now discover dynamic-option values for config fields nested
inside an array of rows (e.g. a Jira `create_issue`'s `fieldMappings[].fieldKey`,
which lists a project + issue type's additional/custom fields). `getResolverField`
and `listResolverFields` (and thus the `automation.resolveActionOptions` tool) now
accept a DOTTED field path that steps through object `properties` and array
`items.properties`, so the model can resolve `fieldMappings.fieldKey` the same way
it resolves top-level fields like `projectKey`. Previously only top-level resolver
fields were reachable, so the assistant could not discover (and therefore could
not populate) additional Jira fields.
