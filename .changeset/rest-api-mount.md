---
"@checkstack/backend": minor
"@checkstack/common": minor
"@checkstack/auth-common": minor
"@checkstack/catalog-common": minor
"@checkstack/healthcheck-common": minor
"@checkstack/incident-common": minor
"@checkstack/maintenance-common": minor
"@checkstack/notification-common": minor
"@checkstack/dependency-common": minor
"@checkstack/slo-common": minor
"@checkstack/anomaly-common": minor
"@checkstack/announcement-common": minor
"@checkstack/cache-common": minor
"@checkstack/gitops-common": minor
"@checkstack/integration-common": minor
"@checkstack/queue-common": minor
"@checkstack/satellite-common": minor
---

Add a `/rest/:pluginId/*` HTTP mount that serves every plugin's oRPC contract
through the REST/OpenAPI shape described by `/api/openapi.json`. Queries are
`GET` with query parameters, mutations are `POST` with the input as the raw
JSON body. The existing `/api/:pluginId/*` mount continues to serve oRPC's
native wire protocol unchanged, so existing clients are not affected.

The OpenAPI spec at `/api/openapi.json` now reflects the real mount: every
`paths` entry is prefixed with `/rest` instead of `/api`.

Also fixes a SPA-fallback bug: the backend's `/api-docs` route previously
returned 404 on production deployments because the static-file middleware
skipped any path starting with `/api`, capturing `/api-docs` along with real
API routes. The skip now requires a trailing slash (`/api/`, `/rest/`).

Required access rules are now visible in the API Docs UI. The OpenAPI spec
generator was reading a non-existent `accessRules` field on procedure
metadata; the real field is `access: AccessRule[]`. Each procedure's access
rules are now flattened to fully-qualified IDs (e.g. `catalog.system.read`)
and emitted under `x-orpc-meta.accessRules`, which the existing
`Required Access Rules` section in the docs UI already knew how to render.

The API Docs schema renderer now handles record types (zod `z.record`),
`$ref`s into `components.schemas`, `oneOf`/`anyOf`/`allOf`, nullable union
types (`type: ["string", "null"]`), and `format` qualifiers. Previously
record outputs like `{ statuses: object }` masked the actual value type;
they now render as `{ [key]: <ResolvedType> { ... } }` with the inner
schema expanded, capped at 12 levels with cycle detection.

**REST method conventions.** `proc()` now defaults to `GET` for queries and
`POST` for mutations on the `/rest` mount, using bracket-notation query
params (`?filter[status]=active&ids[0]=a`) for GET inputs. Existing
procedures were updated to follow REST semantics:

- `update*` mutations → `PATCH`
- `delete*` / `remove*` mutations → `DELETE`
- `getBulk*` queries and any query taking a large array input → `POST`
  (because `@orpc/openapi@1.13.x` has no GET→POST URL-length fallback)

GET endpoints require an `object` input — bare scalars like
`.input(z.string())` are not valid on GET. `getSystemConfigurations` was
refactored from `.input(z.string())` to `.input(z.object({ systemId: ... }))`
to fit the GET shape; the only call-site update was the in-process router
unpacking `input.systemId` instead of passing `input` directly.

The API Docs UI now renders query parameters (path/query/header/cookie) in a
dedicated table for GET endpoints, and the fetch example shows them in the
URL with `<required>` / `<optional>` placeholders.
