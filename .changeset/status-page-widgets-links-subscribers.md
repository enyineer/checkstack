---
"@checkstack/status-page-common": minor
"@checkstack/status-page-backend": minor
"@checkstack/status-page-frontend": minor
"@checkstack/announcement-common": minor
"@checkstack/announcement-backend": minor
"@checkstack/announcement-frontend": minor
"@checkstack/notification-common": minor
"@checkstack/notification-backend": minor
"@checkstack/healthcheck-backend": patch
"@checkstack/incident-backend": patch
"@checkstack/maintenance-backend": patch
"@checkstack/frontend-api": patch
"@checkstack/backend": patch
"@checkstack/frontend": patch
---

Status page enhancements:

- Group-status widget can collapse its member rows while every member is
  operational (auto-expanding on any issue or maintenance).
- New "Announcements" status-page widget, contributed fully externally by the
  announcement plugin: it surfaces active `visibility: "all"` announcements
  through a public-safe DTO (title/message/severity/timestamps only) and never
  affects the page status rollup.
- Incident and maintenance widgets can scope by catalog GROUPS with per-system
  exceptions. Scope is resolved at read time (`(systemIds ∪ members(groupIds)) −
  excludedSystemIds`), so members added to a group later are reflected
  automatically. The builder gets a nested group/system picker.
- Incident and maintenance items on a public page link to dedicated public
  detail pages, gated server-side to items the page's published widgets actually
  surface (no enumeration, no internal-field leak). The custom-domain public
  bundle gains a minimal in-memory router for the two detail pages.
- Fix the custom-domain "Cannot connect to Checkstack backend" screen: a
  configured-but-not-servable custom domain now serves the lean public
  "not available" page instead of the admin shell; the public bundle skips the
  cross-origin `/api/config` probe; CORS admits resolved custom domains; the
  request origin is normalized for proxy scheme/port variance; and re-saving an
  unchanged custom domain no longer clears its verification.
- Anonymous email subscriptions (double opt-in) for incident updates, opt-in per
  status page (`emailSubscriptionsEnabled`, default off): a new
  `status_page_subscribers` table, public subscribe/verify/unsubscribe
  procedures with constant-time responses that fail closed when the page has not
  enabled subscriptions, and team-scoped admin list/remove + an enable toggle in
  the builder. Emails are delivered through a new `sendRawEmail` primitive in
  notification-backend that sends to an arbitrary external address (no auth
  account) via every enabled email strategy (SMTP), with a mandatory unsubscribe
  link.
- Incident/maintenance update fan-out to subscribers via a new
  `notificationAudienceExtensionPoint` in notification-backend. Every
  notification funnelled through `notifyForSubscription` (incident, maintenance,
  health - all unchanged) now also invokes each registered audience sink exactly
  once, enriched with the affected systems and their catalog groups (resolved
  from notification-backend's own resource-parent graph, never a domain import).
  status-page-backend contributes a sink that, AT SEND TIME, matches each
  notification's affected systems against the systems each published + public +
  email-enabled page currently surfaces in its incident/maintenance widgets
  (honoring group membership and per-system exclusions) and emails that page's
  verified subscribers. Send-time scoping against the live layout is the privacy
  boundary: a page only ever emails about systems its widgets surface right now.
  Because `notifyForSubscription` is a single-pod point RPC, each notification
  fans out exactly once cluster-wide.
- Subscriber reconcile on page deletion: the subscriber FK is `ON DELETE
  CASCADE` and page deletion also explicitly purges subscribers (invalidating
  pending verify/unsubscribe tokens) - no orphan rows, no post-deletion send.
  Removing all systems from a page or disabling email is intentionally NOT a
  prune: send-time scoping plus the email-enabled gate make those subscribers
  dormant with no data loss, and re-enabling restores the audience without a
  re-subscribe.
- Send-time scoping is single-source: the fan-out asks each event-feed widget for
  its CURRENT effective system scope (the same live catalog group expansion the
  widget renders from) instead of a parallel copy of group membership, so it can
  never over- or under-deliver relative to what the page shows.
- `sendRawEmail` in notification-backend is now `userType: "service"` (was an
  authenticated procedure gated on `notification.send`). Sending to an arbitrary
  address is an open-relay / email-bomb primitive, so it is callable only by a
  trusted backend-to-backend caller (the status-page subscriber mailer), never by
  an end user.
- Incident/maintenance widgets gain an optional per-system PUBLIC label override
  (`systemLabels`), the same override path the system-health widget uses, so the
  public incident/maintenance detail pages present clean labels instead of raw
  catalog names.
- The anonymous subscribe endpoint adds a coarse per-page quota (max new
  subscribers per rolling hour, counted over durable rows so it holds across
  pods) on top of the per-(page,email) cooldown, capping verification-email
  amplification. The quota is CONFIGURABLE per status page (new nullable
  `email_subscribers_hourly_quota` column; null uses the default of 50, so
  existing pages are unchanged), validated as a positive integer up to 5000,
  editable in the builder next to the email opt-in toggle and gated by the same
  page-manage capability.
- Email verification is now per-page configurable and backed by a platform-global
  once-per-address registry:
  - New `email_verification_required` column (boolean, default true) on
    `status_pages`, exposed on the admin StatusPage DTO + `updateStatusPage`
    input (same page-manage gate) with a builder toggle. When OFF, a new
    subscriber is created active immediately - no verification email, and the
    address is NOT written to the global registry (the operator's trust choice
    for e.g. an internal page).
  - New `status_page_verified_emails` table: one row per normalized address that
    has completed verification on ANY page. When a verification-required page is
    subscribed by an already-globally-verified address, the row is created active
    immediately and a COURTESY email (with one-click unsubscribe) is sent instead
    of a verification email, so a malicious add is always caught. `verify` upserts
    the address into this registry and activates every other pending row for the
    same address in one update (confirm once, all pages).
  - Fan-out is unchanged: it still gates on the per-row `verified` flag; the
    registry only governs whether a NEW subscribe short-circuits to active.

BREAKING CHANGE: `sendRawEmail` is now service-only. Any (non-existent in-tree)
authenticated caller must invoke it through a trusted service client instead.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
