---
"@checkstack/api-docs-frontend": minor
"@checkstack/frontend": minor
"@checkstack/healthcheck-backend": minor
---

Backfill missing package bumps for the `/rest` mount PR — these packages were
modified in that change but were not declared in its changeset:

- `@checkstack/api-docs-frontend`: schema renderer rewrite (`additionalProperties`,
  `$ref` resolution, `oneOf`/`anyOf`/`allOf`, nullable unions, `format`
  qualifiers) and the new path/query/header/cookie parameters table for GET
  endpoints.
- `@checkstack/frontend`: Vite dev-server proxy for `/rest/*` so external REST
  clients pointing at the Vite port resolve to the backend.
- `@checkstack/healthcheck-backend`: router handler now unpacks `input.systemId`
  after `getSystemConfigurations` was refactored from `.input(z.string())` to
  `.input(z.object({ systemId: z.string() }))`.

No behavior change beyond what the original PR already shipped.
