---
"@checkstack/integration-jira-backend": minor
---

Fix the "Create Jira Issue" field-mapping dropdown showing "No options available" on Jira Server / Data Center, and make Jira option-resolver failures loud instead of silent.

- `getFields` (which powers the `fieldKey` dropdown) read the createmeta field list only from the `fields` key. Jira Cloud's `PageOfCreateMetaIssueTypeWithField` does use `fields`, but Jira Server / Data Center returns the same granular endpoint's field list under the standard paginated `values` key (verified on 9.12), so DC came back empty. It now reads `fields ?? values` from `GET /issue/createmeta/{projectIdOrKey}/issuetypes/{issueTypeId}` (the replacement for the bulk `/issue/createmeta` that Jira removed in 9.0), mapping each entry's `fieldId`/`key`. If a response carries neither key, it logs a `warn` with the response keys and returns no options rather than failing silently.
- The Jira option resolver no longer swallows API errors into an empty dropdown: a failing resolver logs the resolver name, connection id, and context keys and rethrows so the integration layer surfaces a clear error. Empty-but-successful field lookups warn with the project/issue type; expected cascade states (a dependency not selected yet) log at `debug`; an unknown resolver name throws.
