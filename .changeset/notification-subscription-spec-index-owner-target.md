---
"@checkstack/notification-backend": minor
---

perf(notification): add composite index on subscription_specs (owner_plugin, target_type_id)

Adds the `subscription_specs_owner_target_idx` index on
`subscription_specs (owner_plugin, target_type_id)`. This serves the
`WHERE owner_plugin = ? AND target_type_id IN (...)` lookup in
`resolveInheritedGroups` at notification-dispatch time, as well as the
per-resource upsert/delete paths that filter specs by owner and target
type. Previously the table had only its primary key, forcing a
sequential scan for these hot-path queries.
