---
"@checkstack/backend": patch
---

Fix plugin schema isolation: create schema before migrations run

Previously, schemas were only created when `coreServices.database` was resolved (after migrations), causing tables to be created in the `public` schema instead of plugin-specific schemas. Now schemas are created immediately before migrations run.

Also removed the `public` fallback from migration search_path to make errors more visible if schema creation fails.
