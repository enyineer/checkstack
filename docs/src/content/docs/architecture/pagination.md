---
title: "Pagination Contract"
description: "The canonical zod schema for paginated list inputs and outputs across every Checkstack RPC contract."
---

# Pagination Contract

Checkstack ships a single shared pagination contract from
`@checkstack/common`. Every paginated list endpoint - across every
`*-common` package - is expected to consume this contract. Inconsistent
shapes (page/pageSize vs limit/offset vs bare limit) made client-side
pagination controls and shared list components painful to write, so we
collapsed them onto one canonical pair.

## Canonical shape

```ts
import { z } from "zod";
import { PaginationInput, PaginatedResult } from "@checkstack/common";

// Input
const ListNotificationsInput = PaginationInput;
// → { limit: number (1-100, default 20), offset: number (>= 0, default 0) }

// Output (factory — pass the per-item schema)
const ListNotificationsOutput = PaginatedResult(NotificationSchema);
// → { items: Notification[], total: number, limit: number, offset: number }
```

- `limit` is an integer in `[1, 100]`, defaulting to `20`.
- `offset` is a non-negative integer, defaulting to `0`.
- `total` echoes the unpaginated row count so the client can render
  page indicators.
- `limit` and `offset` are echoed on the response so the client always
  knows what the server actually applied (including when defaults
  kicked in).

## Why offset-based, not page-based

`limit` + `offset` was chosen over `page` + `pageSize` because:

1. **It composes with cursor-style cursors later.** Adding an optional
   `cursor` field next to `offset` is straightforward; switching the
   primary key from `page` to a cursor is not.
2. **It is unambiguous when `limit` changes mid-session.** A user
   changing the page size while browsing keeps a stable scroll position
   under offset; under page-based pagination the same change silently
   shifts which items are visible.
3. **Backends already speak SQL `LIMIT` / `OFFSET`.** No translation
   layer in the handler.
4. **No `1-vs-0` indexing confusion.** Offsets are always zero-based.

The page-based shape that previously lived in
`integration-common` (`{ page, pageSize }`) is being removed; there is
no `page` / `pageSize` alias on the canonical schema.

## Extending with domain extras

When a list endpoint needs extra filters (e.g. `unreadOnly` on
notifications, `severity` on incidents) compose with `.extend({...})`.
Do not redefine `limit` / `offset`.

```ts
import { z } from "zod";
import { PaginationInput, PaginatedResult } from "@checkstack/common";

export const ListNotificationsInput = PaginationInput.extend({
  unreadOnly: z.boolean().default(false),
});

export const ListNotificationsOutput = PaginatedResult(NotificationSchema);
```

This keeps the canonical fields stable while the domain extras live
next to the procedure that owns them.

## Anti-patterns

- Do not add `page` / `pageSize` aliases on top of `PaginationInput`.
  Pick one shape and stick with it - back-compat aliasing brings the
  inconsistency back through the side door.
- Do not raise the upper bound past `100` without a platform-wide
  discussion. The cap is intentional - it prevents an accidental
  `limit=10000` from blowing the response budget on heavy procedures.
- Do not redefine `total` semantics. It is always the unpaginated row
  count for the same filter criteria.
- Do not silently transform an outer `{ items, total }` into the
  canonical four-field result without also returning `limit` and
  `offset`. The echoed pagination state is part of the contract.

## Status: rollout

The canonical schema is now exported from `@checkstack/common`.
Consumer migration is tracked separately - the existing inline shapes
in `notification-common`, `integration-common`, and `slo-common` will
move to the canonical `PaginationInput` / `PaginatedResult` in a
follow-up. Until then, new procedures should use the canonical
contract; existing ones will be swept in one batch.
