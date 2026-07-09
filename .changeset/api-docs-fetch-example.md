---
"@checkstack/api-docs-frontend": patch
---

Generate realistic API docs fetch examples: real base URL, query values, and body.

The interactive API docs "Fetch Example" previously hardcoded
`http://localhost:3000`, rendered query params as bare `<required|optional>`
placeholders, and emitted only a `// Request body` comment. It now reads the
base URL from the OpenAPI `servers[0].url` (falling back to a relative path),
substitutes real example values for query params from the schema
(example/default/enum), and builds a realistic JSON body from the request-body
schema with `$ref` resolution and cycle guarding. The generator was extracted
into a pure, unit-tested module.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
