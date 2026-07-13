---
"@checkstack/backend": patch
"@checkstack/frontend": patch
---

Refresh `bun.lock` to the newest versions permitted by the existing semver
ranges (Renovate lock-file maintenance). No `package.json` range changed, so
this only affects the resolutions baked into the production image.

Updated dependencies:

- `@ai-sdk/gateway` 3.0.146 -> 3.0.148
- `@eslint/eslintrc` 3.3.5 -> 3.3.6
- `@eslint/js` 9.39.4 -> 9.39.5
- `ai` 6.0.222 -> 6.0.224
- `bullmq` 5.80.0 -> 5.80.1
- `eslint` 9.39.4 -> 9.39.5
- `sanitize-html` 2.17.5 -> 2.17.6
- `shell-quote` 1.9.0 -> 1.10.0
