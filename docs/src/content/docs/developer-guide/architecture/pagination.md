---
title: "Pagination Contract"
description: "The canonical zod schema for paginated list inputs and outputs across every Checkstack RPC contract."
---


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

The page-based shape that previously lived in `integration-common`
(`{ page, pageSize }`) has been removed; there is no `page` /
`pageSize` alias on the canonical schema.

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

The canonical schema is exported from `@checkstack/common` and is the
single source of truth for paginated list inputs and outputs across
every `*-common` package. The deprecated `PaginationInputSchema`,
`paginatedOutput`, and `PaginatedResponse` symbols have been removed -
new code must consume the canonical exports above.

## Migrated procedures

The following procedures were converted to the canonical
`{ limit, offset }` input and `{ items, total, limit, offset }` output
in the v1 pagination sweep:

### `@checkstack/notification-common`

- `getNotifications` - input was the legacy `PaginationInputSchema`
  (`{ limit, offset, unreadOnly }`) with output
  `{ notifications, total }`. Now consumes
  `PaginationInput.extend({ unreadOnly })` (exported as
  `ListNotificationsInputSchema`) and returns
  `PaginatedResult(NotificationSchema)`. The output key renamed from
  `notifications` to `items`.

### `@checkstack/integration-common`

- `listSubscriptions` - input was inline page-based
  `{ page, pageSize, providerId?, eventType?, enabled? }` with output
  `{ subscriptions, total }`. Now consumes
  `PaginationInput.extend({ providerId?, eventType?, enabled? })` and
  returns `PaginatedResult(WebhookSubscriptionSchema)`. The output key
  renamed from `subscriptions` to `items`.
- `getDeliveryLogs` - input was `DeliveryLogQueryInputSchema`
  (`{ subscriptionId?, eventType?, status?, page, pageSize }`) with
  output `{ logs, total }`. The schema now extends `PaginationInput`
  with the same domain filters and returns
  `PaginatedResult(DeliveryLogSchema)`. The output key renamed from
  `logs` to `items`.

### Out of scope for v1

- `slo-common` `getDowntimeEvents` / `getRecentMilestones` and
  `anomaly-common` `getAnomalies` - bare-`limit` top-N feeds, not
  paginated lists (no `total`, no offset, no page UI). They retain
  their existing shape.
- `cache-common` `listEntries` and `queue-common` `listJobs` - already
  use `{ limit, offset }` but with `limit.max(200)` (domain-specific
  upper bound) and an additive `hasMore` / nullable `total` in the
  response envelope to support backends that cannot cheaply count.
  These are intentionally not on the canonical contract.
- `healthcheck-common` `getHistory` / `getDetailedHistory` - already
  use `{ limit, offset }` with `total` in the response. Output key is
  `runs` (semantically meaningful) and the input default is
  `limit=10` rather than the canonical `20`. Migration is deferred to
  avoid churning every history call site for a contract that is
  already substantively correct.
