---
"@checkstack/common": minor
"@checkstack/notification-common": minor
"@checkstack/integration-common": minor
"@checkstack/notification-backend": patch
"@checkstack/integration-backend": patch
"@checkstack/notification-frontend": patch
"@checkstack/integration-frontend": patch
---

Sweep every paginated `*-common` contract onto the canonical
`PaginationInput` / `PaginatedResult` from `@checkstack/common` and
remove the now-unused legacy exports.

**BREAKING CHANGE** - `@checkstack/common` drops the deprecated
`PaginationInputSchema`, `paginatedOutput`, and `PaginatedResponse`
symbols. Callers must consume `PaginationInput` (input) and
`PaginatedResult(itemSchema)` (output) instead. The canonical input is
`{ limit (1-100, default 20), offset (>= 0, default 0) }`; the
canonical output envelope is
`{ items, total, limit, offset }`.

**BREAKING CHANGE** - `@checkstack/notification-common` migrates
`getNotifications` off the legacy `PaginationInputSchema`
(`{ limit, offset, unreadOnly }` with output `{ notifications, total }`)
onto `ListNotificationsInputSchema =
PaginationInput.extend({ unreadOnly })` and
`PaginatedResult(NotificationSchema)`. The output key changes from
`notifications` to `items`, and `limit` / `offset` are now echoed on
the response. The `PaginationInput` type alias previously exported
from `notification-common` is removed - use `ListNotificationsInput`
or the canonical `PaginationInput` from `@checkstack/common`.

**BREAKING CHANGE** - `@checkstack/integration-common` migrates
`listSubscriptions` (inline `{ page, pageSize, ... }` -> output
`{ subscriptions, total }`) and `getDeliveryLogs` (via
`DeliveryLogQueryInputSchema` `{ subscriptionId?, eventType?, status?,
page, pageSize }` -> output `{ logs, total }`) onto the canonical
`PaginationInput.extend({...})` input and
`PaginatedResult(itemSchema)` output. External callers must switch
from `{ page, pageSize }` to `{ limit, offset }` and read response
items from `data.items` (no more `data.subscriptions` / `data.logs`).

The matching `*-backend` handlers were updated to consume the new
input shape (`offset` arithmetic in lieu of `(page - 1) * pageSize`)
and to echo `limit` / `offset` on the response. The `*-frontend` call
sites in `NotificationsPage`, `NotificationBell`, `IntegrationsPage`,
and `DeliveryLogsPage` were updated to send the new input shape and
read `data.items`.
