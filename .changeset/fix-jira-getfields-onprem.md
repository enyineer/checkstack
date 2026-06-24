---
"@checkstack/integration-jira-backend": minor
---

Fix the "Create Jira Issue" field-mapping dropdown showing "No options available" on Jira Server / Data Center, and make Jira option-resolver failures loud instead of silent.

- `getFields` (which powers the `fieldKey` dropdown) now picks its createmeta endpoint by deployment, matching Atlassian's documented response shapes:
  - **Cloud**: `GET /rest/api/3/issue/createmeta/{projectIdOrKey}/issuetypes/{issueTypeId}` (`PageOfCreateMetaIssueTypeWithField`), reading the documented `fields` array (with a defensive `values` fallback).
  - **Data Center**: `GET /rest/api/2/issue/createmeta?projectKeys=...&issuetypeIds=...&expand=projects.issuetypes.fields`, reading the documented `projects[].issuetypes[].fields` object map (keyed by field id). This avoids relying on the granular per-issue-type endpoint, which was returning an empty field-mapping dropdown on DC.
- The Jira option resolver no longer swallows API errors into an empty dropdown: a failing resolver now logs the resolver name, connection id, and context keys and rethrows so the integration layer surfaces a clear error. Empty-but-successful responses (e.g. a wrong project key, missing permissions, or an unexpected createmeta shape) emit a `warn` with the endpoint and response keys; expected cascade states (a dependency not selected yet) log at `debug`. An unknown resolver name now throws instead of silently returning no options.
