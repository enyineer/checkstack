---
"@checkmate-monitor/backend": patch
---

Fixed CI test failures by implementing proper module mocking infrastructure:
- Added test-preload.ts with comprehensive mocks for db, logger, and core-services
- Added skipDiscovery option to loadPlugins() for test isolation
- Configured bunfig.toml preload for workspace-wide test setup
