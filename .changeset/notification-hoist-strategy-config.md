---
"@checkstack/notification-backend": patch
---

Cut the per-recipient database round-trips in the notification dispatch fan-out.
`notifyForSubscription` invoked `sendToExternalChannels` once per recipient, and
each call re-read the RECIPIENT-INDEPENDENT strategy config (enabled meta,
strategy config, layout config) for every enabled strategy — turning a dispatch
to R recipients over S strategies into `R × S × 3` standalone config SELECTs.

- The three recipient-independent strategy reads (meta / config / layout) are now
  resolved ONCE per strategy via `preloadStrategyConfigs`, before the recipient
  loop, and the resulting map is reused for every recipient. This collapses the
  `R × S × 3` config reads to `S × 3`. The fully-qualified action + subject deep
  links are likewise computed once for the whole fan-out instead of per recipient.
- Only the genuinely per-recipient reads remain inside the loop: the user record
  and that user's own per-strategy preference. When no strategy is both enabled
  and configured, the per-recipient loop (and its user lookups) is skipped
  entirely.
- These reads go through `ConfigService`, which owns its own scoped-db connection
  and exposes no transaction handle, so they cannot be threaded through a single
  `withScopedTransaction`; hoisting them out of the per-recipient loop is the
  batching win.

Behavior unchanged; performance-only (removes per-recipient re-fetch of
recipient-independent strategy config). The same recipients are notified, each
recipient's own channel preference is still applied, per-attempt error isolation
and delivery ordering are preserved, and the network `strategy.send()` plus the
post-send delivery-attempt INSERT stay outside any DB transaction.
