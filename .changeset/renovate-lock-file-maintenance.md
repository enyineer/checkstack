---
"@checkstack/backend": patch
"@checkstack/frontend": patch
---

Refresh `bun.lock` to the newest versions permitted by the existing semver
ranges (Renovate lock-file maintenance). No `package.json` range changed, so
this only affects the resolutions baked into the production image.

Updated dependencies:

- `@ai-sdk/gateway` 3.0.146 -> 3.0.147
- `ai` 6.0.222 -> 6.0.223
- `bullmq` 5.80.0 -> 5.80.1
