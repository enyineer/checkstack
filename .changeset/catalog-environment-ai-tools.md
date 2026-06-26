---
"@checkstack/catalog-backend": minor
---

feat(catalog): AI tools for environments

Add `catalog.createEnvironment` and `catalog.setSystemEnvironments` AI tools plus
a `catalog.listEnvironments` read projection, so the assistant can model
one-system-many-environments instead of suggesting a separate system per
environment. The `catalog.createSystem` tool description now teaches the 1-1
system/check pairing and points to environments for modelling dev/staging/prod.
