---
"@checkstack/healthcheck-frontend": minor
---

Health-check overview and run history: group stale checks, resolve environment
names for old runs, and show absolute run timestamps.

- The system overview now detects health-check slices that no longer receive
  runs after an environment change - the env-less leftover of a check that has
  since fanned out to environments, a slice for an environment that was removed,
  and the case where all environments are removed - and tucks them into a
  collapsed "Old checks" group. Their history is preserved; they just stop
  cluttering the live list.
- Environment pills across the overview and the run-history surfaces now resolve
  names from all environments (not only those still assigned to the system), so
  a run for an environment that was later UNASSIGNED shows the environment's
  name instead of its raw id. An environment that was actually DELETED reads as
  "Removed environment" rather than a UUID.
- The overview environment pill is now a single shared primitive with
  context-independent sizing, so pills render at the same size inside the "Old
  checks" group as in the live list.
- The "Recent Runs" table now stacks the absolute datetime over the relative
  "x ago" string instead of hiding the datetime behind a hover tooltip, so the
  exact time is readable at a glance.
