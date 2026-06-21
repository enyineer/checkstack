---
"@checkstack/healthcheck-backend": minor
---

Add an AI assistant tool that lists the health checks assigned to a system.

The assistant previously had `healthcheck.status` (every check globally) but no
way to map a check to a system, so it had to guess which check monitored a given
system. It now projects `getSystemConfigurations` as the read-only tool
`healthcheck.listSystemChecks`: given a `systemId` (resolved from a name via
`catalog.listSystems`), it returns the checks assigned to that system - id, name,
strategy, interval, collectors/assertions, and paused state. The tool inherits
the source procedure's system-scoped `configuration.read` gate, so it stays
team-scoped and needs no new permission.
