---
"@checkstack/common": minor
---

Add the canonical `PaginationInput` zod schema and `PaginatedResult`
output factory in `@checkstack/common`. `PaginationInput` is an
integer-clamped `{ limit: 1-100 (default 20), offset: >= 0 (default 0) }`
shape that composes with `.extend({...})` for domain-specific filters
(e.g. `unreadOnly` on notifications). `PaginatedResult(itemSchema)`
returns the standard `{ items, total, limit, offset }` envelope. The
existing `PaginationInputSchema` / `paginatedOutput` / `PaginatedResponse`
exports are now marked `@deprecated` and will be removed once the
follow-up sweep migrates every `*-common` consumer to the canonical
contract.
