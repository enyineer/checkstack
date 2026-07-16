---
"@checkstack/backend": patch
"@checkstack/frontend": patch
---

Refresh `bun.lock` to the newest versions permitted by the existing semver
ranges (Renovate lock-file maintenance). No `package.json` range changed, so
this only affects the resolutions baked into the production image.

Updated dependencies:

- `hono` 4.12.28 -> 4.12.30
