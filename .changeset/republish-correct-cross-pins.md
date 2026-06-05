---
"@checkstack/common": patch
---

Republish the platform with correct internal cross-pins.

The release pipeline's `version-packages` step ran `changeset version` (bumping every `package.json`) but never refreshed `bun.lock`, so the lockfile kept the pre-bump versions. Because `bun publish` resolves `workspace:*` from the lockfile, every published package pinned the *previous* version of its `@checkstack/*` siblings (e.g. `@checkstack/backend-api@0.21.1` shipped depending on `@checkstack/cache-api@0.3.9` and `@checkstack/common@0.13.0` instead of `0.3.10` / `0.14.0`). That reintroduced the `backend-api -> cache-api -> backend-api` cycle for registry consumers and pinned `cache-api`/`queue-api` to a `common` version predating the `Logger`/`Migration` types they import.

`version-packages` now runs `bun install --lockfile-only` after `changeset version`, so the lockfile matches the bumped versions before publish. This patch bump cascades through the dependency graph so every package republishes with its cross-pins resolved against the freshly-bumped versions.
