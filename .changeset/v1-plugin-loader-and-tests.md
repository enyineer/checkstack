---
"@checkstack/backend": patch
"@checkstack/notification-backend": patch
---

Phase 9 of the v1 polishing plan: tighten the plugin loader's boot-time
hook policy and backfill notification-router test coverage.

`@checkstack/backend` adopts an explicit per-hook policy for the two
boot-time hooks the plugin loader emits. `pluginInitialized` now
**halts the boot** if a subscriber throws — a failing subscriber here
means a downstream never wired itself against the freshly initialised
plugin, and continuing past that would leave the platform serving
traffic in a half-wired state. `accessRulesRegistered` keeps its
log-and-continue behaviour but escalates to `error` level and emits a
summary count if any subscriber failed; boot-blocking this hook would
let one misbehaving plugin DOS every other plugin on the same
instance. The policy is documented inline at each emit site and in a
new `docs/src/content/docs/backend/plugin-hook-policy.md` page.
**BREAKING CHANGE**: subscribers to `pluginInitialized` that
previously threw silently (logged and swallowed) now halt platform
boot. Audit subscribers and ensure they handle their own internal
errors before throwing.

`@checkstack/notification-backend` ships a real
`core/notification-backend/src/router.test.ts` covering the dispatch
fan-out (`notifyForSubscription`: zero subscribers, multi-recipient
insert, `excludeUserIds`, plus NOT_FOUND/FORBIDDEN guard rails), the
canonical paginated read on `getNotifications` (envelope shape,
`unreadOnly` filter propagation, null→undefined column mapping), the
service-only `createGroup` upsert behaviour (happy path + idempotent
re-create), and the multi-strategy `sendTransactional` path with a
focused fallback-style assertion: when one strategy throws, the
dispatch loop continues to the next and surfaces the failure as a
per-strategy `success: false` row instead of short-circuiting. No
runtime changes to the notification router.
