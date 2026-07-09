---
"@checkstack/test-utils-backend": patch
---

Add a `lockPool` to `createMockDbModule()`, mirroring the real `db` module's
advisory-lock pool. `connect()` yields a client the advisory-lock service can
drive (`query`/`release`/`on`/`off`), so a rotation critical section that runs
through the default KeyStore no longer crashes under the mock DB.
