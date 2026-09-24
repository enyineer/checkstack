---
"@checkstack/ai-backend": patch
"@checkstack/pluginmanager-frontend": patch
---

Adapt to the access-rule consistency fixes: regenerated docs index for the corrected notification strategy access-rule format (`{ownerPluginId}.strategy.{id}.manage`), and the plugin manager UI now gates install and uninstall actions on the single `pluginManagerAccess.manage` rule.
