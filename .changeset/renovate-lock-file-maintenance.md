---
"@checkstack/backend": patch
"@checkstack/frontend": patch
---

Refresh `bun.lock` to the newest versions permitted by the existing semver
ranges (Renovate lock-file maintenance). No `package.json` range changed, so
this only affects the resolutions baked into the production image.

Updated dependencies:

- `@module-federation/vite` 1.16.14 -> 1.16.15
- `@ungap/structured-clone` 1.3.2 -> 1.3.3
- `ignore` 7.0.5 -> 7.0.6
