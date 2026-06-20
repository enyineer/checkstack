---
"@checkstack/automation-backend": patch
---

refactor: use `extractErrorMessage` instead of `(error as Error).message`

All 24 `(error as Error).message` casts in `automation-backend`'s dispatch and
entity modules are replaced with the project-wide `extractErrorMessage(error)`
helper from `@checkstack/common`. This removes the unsafe `error as Error`
assumption (the same one the lint-banned `instanceof Error` would make) and
correctly handles non-Error throwables (strings, plain objects) in log output.
