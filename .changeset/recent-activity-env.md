---
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/dashboard-frontend": minor
---

Show the environment for fanned-out runs in the dashboard Recent Activity feed.
The `healthcheck.run.completed` signal now carries optional `environmentId` and
`environmentName` fields, populated at the two per-environment fan-out broadcast
sites in the run executor. The Dashboard "Recent activity" terminal feed renders
the environment name inline (`system (config) @ env -> status`) when a run was
fanned out to an environment. Runs that are not environment-scoped omit both
fields and render exactly as before, so their behavior is unchanged.
