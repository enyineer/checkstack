---
"@checkstack/ui": patch
"@checkstack/theme-frontend": patch
---

Implemented a manual "Low Power Mode" toggle in the user menu, allowing users to explicitly disable expensive visual effects. This replaces the previous automatic performance diagnostics with a more predictable, user-controlled system that persists to localStorage while still respecting OS-level "Reduced Motion" settings.
