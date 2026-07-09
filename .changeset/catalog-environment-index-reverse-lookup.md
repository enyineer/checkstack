---
"@checkstack/catalog-backend": minor
---

perf(catalog): add index systems_environments_environment_idx on systems_environments(environment_id)

The systems_environments junction table's primary key leads with system_id, leaving the environment_id direction unindexed. Reverse lookups (inArray(environment_id, ids)) used by the environment and system detail views had to scan the table. This adds a btree index on environment_id to serve those reverse-lookup queries.
