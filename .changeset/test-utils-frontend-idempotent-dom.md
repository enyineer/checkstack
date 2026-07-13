---
"@checkstack/test-utils-frontend": patch
---

Make the frontend test setup's Happy DOM registration idempotent. A test file
that imports `@checkstack/test-utils-frontend/setup` directly also runs under
the root test runner (whose bunfig does not preload it), while package-scoped
runs preload it via bunfig - so the DOM could be registered twice, which throws.
The setup now registers only when no `document` global exists yet.
