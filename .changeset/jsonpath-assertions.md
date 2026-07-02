---
"@checkstack/healthcheck-backend": minor
"@checkstack/backend-api": minor
"@checkstack/healthcheck-frontend": minor
---

Fix JSONPath collector assertions: the executor previously evaluated every
assertion with a flat field lookup, so a `Body (JSONPath)` assertion compared
against `undefined` and the configured path was silently ignored (`Exists`
always failed, `Not Exists` always passed). The executor now parses the source
field as JSON and extracts the configured path via `jsonpath-plus` (with
expression evaluation disabled - filter/script expressions are rejected).
Fail-closed: a non-JSON body, missing expression, or invalid path fails the
assertion with a diagnostic, never the collection.

Also adds `isEmpty` / `isNotEmpty` to the JSONPath operator set (and the
AssertionBuilder), treating `[]`, `{}`, `""`, and missing values as empty - so
"no errors reported" is a single `$.errors Is Empty` assertion, and "key exists
but is empty" is `Exists` + `Is Empty` on the same path.
