---
"@checkstack/integration-jira-backend": minor
"@checkstack/integration-backend": patch
---

feat(jira): register Jira automation actions + `jira.issue` artifact type

Adds three Jira actions to the Automation platform:

- `jira.create_issue` — produces the new `jira.issue` artifact type
  (`issueKey`, `projectKey`, `issueUrl`, `id`, `status?`)
- `jira.transition_issue` — consumes `jira.issue` (or accepts an
  explicit `issueKey`), idempotent against already-applied transitions
- `jira.add_comment` — consumes `jira.issue` (or accepts an explicit
  `issueKey`)

Extends the Jira client with `getTransitions`, `getIssueStatus`,
`transitionIssue` (handles 204 No Content, comment in ADF for Cloud /
plain text for Data Center), and `addComment`. Adds a new
`JIRA_RESOLVERS.TRANSITION_OPTIONS` cascading dropdown driven by
`connectionId` + `issueKey`. `@checkstack/integration-backend` now
re-exports the `ConnectionStore` interface so action plugins can take
it as a typed dep.
