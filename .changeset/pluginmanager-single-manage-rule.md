---
"@checkstack/pluginmanager-common": minor
---

Consolidate plugin install and uninstall into a single access rule. `pluginManagerAccess.install` and `pluginManagerAccess.uninstall` both produced the identical qualified id `pluginmanager.plugin.manage` (collapsing into one row with an ambiguous description in the role editor); they are replaced by a single `pluginManagerAccess.manage` ("Install and uninstall plugins").

BREAKING CHANGES: the `install` and `uninstall` keys were removed from `pluginManagerAccess` - use `pluginManagerAccess.manage`. The qualified rule id `pluginmanager.plugin.manage` is unchanged, so existing role grants keep working.
