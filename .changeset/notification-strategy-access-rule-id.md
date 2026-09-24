---
"@checkstack/notification-backend": patch
"@checkstack/backend-api": patch
---

Fix the notification strategy access rule id mismatch. The registry checked `{ownerPluginId}.strategy.{id}.use` while the emitted rule carried the unqualified id `strategy.{id}.manage`, so the two never matched. Both now derive from the same `AccessRule` object and use the qualified id `{ownerPluginId}.strategy.{id}.manage`, which also makes the rule rows participicate in the plugin-deregistered cleanup sweep. `getStrategiesForUser` additionally honours the `"*"` admin wildcard.
