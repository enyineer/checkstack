---
"@checkstack/backend-api": minor
"@checkstack/backend": minor
---

Added collector registry lifecycle cleanup during plugin unloading.

- Added `unregisterByOwner(pluginId)` to remove collectors owned by unloading plugins
- Added `unregisterByMissingStrategies(loadedPluginIds)` for dependency-based pruning
- Integrated registry cleanup into `PluginManager.deregisterPlugin()`
- Updated `registerCoreServices` to return global registries for lifecycle management
