---
"@checkstack/integration-jira-backend": patch
---

Fix the Jira `search_issues` action failing with HTTP 410 on Jira Cloud. Atlassian
deprecated the legacy `/rest/api/3/search` endpoint on 2024-05-01 and removed it on
2025-05-01 (CHANGE-2046), so every Cloud search (and the "create a ticket only if
none is open" pattern that depends on it) broke. The client now calls
`/rest/api/3/search/jql` for Cloud connections (deriving result existence from the
returned issues, since the new endpoint returns no `total`), while Jira Data
Center / Server (on-prem) connections keep using the legacy `/search`, which they
still serve and where `/search/jql` does not exist. The endpoint is selected by the
connection's auth mode (cloud vs datacenter).
