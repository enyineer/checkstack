---
"@checkstack/backend": patch
---

Added startup validation for unregistered access rules

The backend now throws an error at startup if a procedure contract references an access rule that isn't registered with the plugin system. This prevents silent runtime failures.
