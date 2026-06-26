---
"@checkstack/common": minor
---

feat(common): add the environments docs slug to APP_DOC_SLUGS

Expose `APP_DOC_SLUGS.environments` so in-app deep links can point to the
Environments concept page (used by the onboarding wizard's environments hint).
Guarded by the existing docs-links contract test.
