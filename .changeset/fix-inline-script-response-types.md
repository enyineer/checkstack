---
"@checkstack/ui": patch
---

Fix inline-script editor `Response` type missing `ok`/`status`/`body` (and
`Request`/`Headers`/`fetch` members).

The editor's Monaco virtual filesystem bundled `@types/node` and `bun-types`
but not `undici-types`, which both packages reference via
`import("undici-types").Response` for the concrete fetch-API members. With
`undici-types` absent those imports resolved to `any`/`{}`, so the global
`Response` collapsed to just the `headers` override `bun-types` adds. The
stdlib-types generator now bundles `undici-types` alongside `@types/node` and
`bun-types`.
