---
title: "Notification Delivery Tracking"
description: "Per-channel delivery-attempt visibility for the external notification dispatch loop. Surfaces silent failures (misconfigured webhooks, dead channels) to admins without grepping logs. Visibility only - retries are not implemented in v1."
---


Pre-v1 the external notification dispatch loop swallowed every send
error with a `logger.error(...)` call and moved on. A misconfigured
Discord webhook or a dead Slack channel was effectively invisible to
admins unless someone went hunting through server logs. Phase 8 of the
v1 polishing plan adds a per-channel delivery-attempt log so failures
become first-class, queryable data.

> [!IMPORTANT]
> This is a **visibility** surface, not a retry mechanism. A
> `"failure"` row is a final outcome that an admin actions manually
> (re-trigger the source event, fix the misconfigured channel, etc.).
> Automatic retry / backoff is deferred to v1.1.

## What gets recorded

Every call into a registered `NotificationStrategy.send(...)` from the
external-delivery loop in
[`core/notification-backend/src/router.ts`](../../../../../core/notification-backend/src/router.ts)
produces exactly one row in `notification_delivery_attempts`, regardless
of outcome. The dispatch helper that owns this contract lives at
[`core/notification-backend/src/delivery-attempts.ts`](../../../../../core/notification-backend/src/delivery-attempts.ts):

- The strategy resolves with `{ success: true }` -> `status="success"`,
  `errorMessage=null`.
- The strategy resolves with `{ success: false, error }` -> `status="failure"`,
  `errorMessage = result.error ?? "Strategy reported failure"` (the
  strategy's own already-sanitised message).
- The strategy throws -> `status="failure"`,
  `errorMessage = extractErrorMessage(error)`. The raw error is **never**
  persisted, since strategy send contexts can carry webhook URLs and
  tokens that may be embedded in raw error objects.

In all three cases `durationMs` is the wall-clock time of the `send()`
call itself - not contact resolution, config loading, or surrounding
queue overhead.

### Best-effort persistence

The attempt insert is wrapped in its own try/catch and never propagates
- a DB blip while writing the attempt row logs an error and returns,
so we don't replace one silent dispatch failure with a new one. Tests
in
[`core/notification-backend/src/delivery-attempts.test.ts`](../../../../../core/notification-backend/src/delivery-attempts.test.ts)
pin this guarantee.

## Table shape

The schema lives in
[`core/notification-backend/src/schema.ts`](../../../../../core/notification-backend/src/schema.ts):

```ts
export const notificationDeliveryStatusEnum = pgEnum(
  "notification_delivery_status",
  ["success", "failure"],
);

export const notificationDeliveryAttempts = pgTable(
  "notification_delivery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    strategyQualifiedId: text("strategy_qualified_id").notNull(),
    attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
    status: notificationDeliveryStatusEnum("status").notNull(),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms").notNull(),
  },
  (t) => ({
    notificationIdx: index("notification_delivery_attempts_notification_idx").on(
      t.notificationId,
    ),
    attemptedAtIdx: index("notification_delivery_attempts_attempted_at_idx").on(
      t.attemptedAt,
    ),
  }),
);
```

Indexes:

- `notification_id` for "show me every attempt for notification X".
- `attempted_at` for the default "newest first" ordering.

Cascade delete on `notificationId` keeps retention sweeps simple - when
the parent notification is purged, its attempt log goes with it.

## Reading attempts

The contract surface is a single read procedure in
[`core/notification-common/src/rpc-contract.ts`](../../../../../core/notification-common/src/rpc-contract.ts):

```ts
getDeliveryAttempts: proc({
  operationType: "query",
  userType: "user",
  access: [notificationAccess.admin],
})
  .input(ListDeliveryAttemptsInputSchema)
  .output(PaginatedResult(DeliveryAttemptSchema)),
```

### Input

`ListDeliveryAttemptsInputSchema` is the canonical `PaginationInput`
extended with an optional `notificationId` filter:

```ts
export const ListDeliveryAttemptsInputSchema = PaginationInput.extend({
  notificationId: z.string().uuid().optional(),
});
```

- `limit` (1-100, default 20) and `offset` (>= 0, default 0) match the
  canonical pagination contract documented in
  [Pagination](/checkstack/developer-guide/architecture/pagination/).
- `notificationId` is optional. When supplied the result is scoped to
  that notification; otherwise the caller sees every recent attempt
  across the platform (still newest first).

> [!CAUTION]
> The procedure deliberately does **not** accept user-supplied SQL
> filters, free-form `orderBy` clauses, or status-only filters. The
> shape is fixed - if you need a richer view, propose it in a new RFC,
> don't extend this input quietly.

### Output

`PaginatedResult(DeliveryAttemptSchema)` returns the standard
`{ items, total, limit, offset }` envelope. Each item is the row 1:1:

```ts
export const DeliveryAttemptSchema = z.object({
  id: z.string().uuid(),
  notificationId: z.string().uuid(),
  strategyQualifiedId: z.string(),
  attemptedAt: z.coerce.date(),
  status: z.enum(["success", "failure"]),
  errorMessage: z.string().nullable(),
  durationMs: z.number().int().min(0),
});
```

### Access rule

`getDeliveryAttempts` is gated by `notificationAccess.admin`
(`notification:manage`). Callers without that rule receive
`FORBIDDEN` from `autoAuthMiddleware` before the handler runs - there
is no client-side `isAdmin` check anywhere. The frontend renders the
resulting error via its standard error-state branch.

If you need to grant a non-admin role visibility into delivery attempts
(e.g. an on-call "incident commander" role), grant that role the
`notification:manage` access rule via the regular role-management flow.
Don't fork the procedure.

## Admin UI surface

A minimal admin-only page is wired at
`/notifications/delivery-attempts` (route id
`notification.deliveryAttempts`), implemented in
[`core/notification-frontend/src/pages/DeliveryAttemptsPage.tsx`](../../../../../core/notification-frontend/src/pages/DeliveryAttemptsPage.tsx).

It renders the most recent attempts (newest first) as a paginated table
with columns: `Attempted at`, `Strategy`, `Status` (coloured badge),
`Duration`, and a truncated `Error` (full text on hover via
`title`).

Discoverability: the Notification Settings page renders an "Open
inspector" button in a dedicated section visible to users who hold
`notification:manage`. The nav-entry hide is **cosmetic only**;
security is enforced by the contract.

UI scope is intentionally minimal:

- No filter chips, no status-only view, no charts.
- No CSV export.
- No retry trigger (deferred to v1.1).

If a page needs richer ergonomics, build it on top of
`getDeliveryAttempts` rather than expanding the procedure.

## What's deferred to v1.1

- **Retries with backoff**: visibility first; an automated retry policy
  is a separate design conversation. A `failure` here is a final
  outcome admins action manually.
- **Aggregation / dashboards**: success-rate-per-strategy, p50/p99
  duration, failure-by-error-class - none of these are in scope. Plain
  list, plain badges.
- **Webhooks / push on failure**: if a failure should page an on-call
  rotation, that belongs in the (v1.1) on-call rotations design, not
  in this loop.
