---
"@checkstack/dependency-backend": minor
---

perf(dependency): add indexes on dependency edge and rule lookups

Add two Postgres indexes to speed up hot dependency-graph queries fired on
every health-state change:

- `dependency_health_check_rules_dependency_idx` on
  `dependency_health_check_rules(dependency_id)` - serves the
  `inArray(dependency_id, ids)` FK filter behind every getDependencies /
  getAllDependencies (topology and warning builds).
- `dependencies_target_system_idx` on `dependencies(target_system_id)` -
  serves the downstream branch `eq(target_system_id, systemId)`
  (getDownstreamSystemIds on every degrade/recover). The existing
  `uq_dependency_edge` unique only covers the source_system_id direction, so
  this plain index is added alongside it.
