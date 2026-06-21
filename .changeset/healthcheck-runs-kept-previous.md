---
"@checkstack/healthcheck-frontend": patch
---

Refactor `HealthCheckRunsTable` to consume the shared `useKeptPrevious` hook
from `@checkstack/ui` for its keep-previous-rows-during-refetch behaviour.
Behaviour is unchanged: previous rows are held to avoid a layout jump and dimmed
while stale.
