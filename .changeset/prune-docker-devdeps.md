---
"@checkstack/backend": patch
---

Prune devDependencies and development-only source folders (like `core/scripts` and `test-utils-*`) from the production Docker image to reduce size and improve security.
