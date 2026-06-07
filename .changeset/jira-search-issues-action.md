---
"@checkstack/integration-jira-backend": minor
---

feat(integration-jira): add a read-only `search_issues` automation action

Automations can now check Jira for matching issues without a hand-rolled
fetch. The new `search_issues` action (id `integration-jira.search_issues`)
takes a connection plus a structured query (project / status / status
category / summary contains) and/or raw JQL, queries Jira's search endpoint
read-only, and produces an `integration-jira.issue_search` artifact shaped
`{ found, count, issues: [{ key, url, status, summary }], firstIssueKey? }`.

A downstream `choose` / `condition_guard` can gate creation on
`{{ not artifacts.<id>.issue_search.found }}` so an automation does not file
a duplicate ticket (the "is there already an open ticket?" case).
