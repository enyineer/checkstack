---
"@checkstack/backend": patch
"@checkstack/frontend": patch
---

Refresh `bun.lock` to the newest versions permitted by the existing semver
ranges (Renovate lock-file maintenance). No `package.json` range changed, so
this only affects the resolutions baked into the production image.

Updated dependencies:

- `@orpc/client` 1.14.7 -> 1.14.8
- `@orpc/contract` 1.14.7 -> 1.14.8
- `@orpc/interop` 1.14.7 -> 1.14.8
- `@orpc/json-schema` 1.14.7 -> 1.14.8
- `@orpc/openapi` 1.14.7 -> 1.14.8
- `@orpc/openapi-client` 1.14.7 -> 1.14.8
- `@orpc/server` 1.14.7 -> 1.14.8
- `@orpc/shared` 1.14.7 -> 1.14.8
- `@orpc/standard-server` 1.14.7 -> 1.14.8
- `@orpc/standard-server-aws-lambda` 1.14.7 -> 1.14.8
- `@orpc/standard-server-fastify` 1.14.7 -> 1.14.8
- `@orpc/standard-server-fetch` 1.14.7 -> 1.14.8
- `@orpc/standard-server-node` 1.14.7 -> 1.14.8
- `@orpc/standard-server-peer` 1.14.7 -> 1.14.8
- `@orpc/tanstack-query` 1.14.7 -> 1.14.8
- `@orpc/zod` 1.14.7 -> 1.14.8
- `hono` 4.12.28 -> 4.12.30
- `tsx` 4.23.0 -> 4.23.1
