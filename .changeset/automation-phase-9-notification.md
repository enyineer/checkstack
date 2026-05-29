---
"@checkstack/notification-backend": minor
---

feat(notification): Phase 9 — delivered/failed triggers + send action

- New hooks `notificationHooks.delivered` and `notificationHooks.failed`,
  fired from the shared `dispatchWithAttempt` funnel so every external
  delivery path (subscription fan-out + transactional send) surfaces
  uniformly. Persisted attempt rows are unchanged — the hooks are
  best-effort and never block dispatch.
- Triggers `notification.delivered`, `notification.failed`, both
  carrying `contextKey: (p) => p.notificationId` so an automation can
  resume the run that opened the notification.
- Action `notification.send` wraps the existing `userType: "service"`
  `sendTransactional` RPC, so automation-driven sends honour the same
  per-user strategy preferences + contact resolution as code-driven
  ones. Returns a `notification.send_result` artifact (per-strategy
  outcome).

Plumbing note: `createNotificationRouter` now takes a late-bound
`getDispatchHookSink` getter. `register()` constructs an empty mutable
container that the router reads on every dispatch; `afterPluginsReady`
populates it with the real `emitHook`. Until populated (e.g. in
stripped-down test harnesses) delivery proceeds without firing the
hooks — no behaviour change for existing callers.
