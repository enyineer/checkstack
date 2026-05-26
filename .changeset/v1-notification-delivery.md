---
"@checkstack/notification-backend": minor
"@checkstack/notification-common": minor
"@checkstack/notification-frontend": patch
---

Add per-channel notification delivery-attempt tracking
(Phase 8 of the v1 polishing plan). The external dispatch loop now
persists one row per `strategy.send(...)` call into a new
`notification_delivery_attempts` table - both successes and
failures - so silent delivery breakage (misconfigured webhooks, dead
channels) becomes queryable instead of buried in logs.

- `@checkstack/notification-backend` adds the
  `notification_delivery_attempts` table, the matching Drizzle
  migration, and a new `dispatchWithAttempt` helper that wraps every
  external `strategy.send(...)` with duration measurement and
  best-effort row persistence. The insert is intentionally
  fire-and-forget: if writing the attempt row itself errors, the
  dispatch loop logs and continues so visibility tracking can never
  introduce a *new* silent failure.
- `@checkstack/notification-common` exports a new
  `DeliveryAttemptSchema` zod schema, the
  `ListDeliveryAttemptsInputSchema =
  PaginationInput.extend({ notificationId })` input, and a new
  `getDeliveryAttempts` procedure on the contract. The procedure is
  gated by the existing `notificationAccess.admin`
  (`notification:manage`) access rule - no new permission was
  introduced.
- `@checkstack/notification-frontend` adds a minimal admin-only
  `DeliveryAttemptsPage` (route id `notification.deliveryAttempts`,
  path `/notifications/delivery-attempts`) and an "Open inspector"
  link from the Notification Settings page for users with
  `notification:manage`. No client-side `isAdmin` gate - the FORBIDDEN
  case is rendered via the standard error-state branch on the page,
  enforced by the contract.

Visibility only: there is no retry mechanism in this phase. A
`failure` row is a final outcome an admin actions manually
(re-trigger the source event, fix the misconfigured channel).
Automated retries are deferred to v1.1.

Strategy errors thrown during `send(...)` are persisted via
`extractErrorMessage(error)` so secrets potentially embedded in raw
error objects (webhook URLs, OAuth tokens reachable from the strategy
send context) are not stored verbatim.

See the new
`docs/src/content/docs/backend/notification-delivery.md` page for the
full surface description.
