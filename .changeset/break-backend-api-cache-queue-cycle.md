---
"@checkstack/common": minor
"@checkstack/backend-api": patch
"@checkstack/cache-api": patch
"@checkstack/queue-api": patch
---

Break the publish-time dependency cycle between `@checkstack/backend-api` and `@checkstack/cache-api` / `@checkstack/queue-api`.

`cache-api` and `queue-api` only ever used `Logger` and `Migration` from `backend-api` as `import type`, yet declared `@checkstack/backend-api` as a runtime dependency. In the monorepo this is harmless (everything resolves via `workspace:*`), but once published, `bun publish` freezes each `workspace:*` into a concrete pin of the *other* package's then-current version. Because the dependency is mutual, a consumer installing these packages from the registry must resolve `backend-api -> cache-api -> backend-api -> ...` backward through release history until it reaches ancient versions that shipped raw `workspace:*` ranges and a long-removed `@checkstack/cache-api@0.1.0` pin - which fail to resolve. This surfaced as `bun install` errors (and a missing `checkstack-dev` binary) in freshly scaffolded standalone plugins.

`Logger` and `Migration` now live in `@checkstack/common` (a dependency-free leaf package). `@checkstack/backend-api` re-exports both for backward compatibility, so existing `import type { Logger, Migration } from "@checkstack/backend-api"` call sites are unchanged. `cache-api` and `queue-api` now depend on `@checkstack/common` instead of `@checkstack/backend-api`, removing the cycle.
