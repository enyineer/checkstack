---
"@checkstack/test-utils-backend": patch
---

Two test-harness improvements:

- Add `isLoadTestEnabled()` - true only when `CHECKSTACK_LOAD_TESTS=1` is set on
  top of the integration lane - so load guards (sustained high-rate ingest,
  event-loop pressure probes) never run in the normal `bun test` / CI lanes and
  are opt-in via `bun run test:load`.
- The mock queue now logs the caught handler error's MESSAGE instead of the raw
  `Error` object. Bun renders a logged `Error` as a red `error:` block with a
  stack, so an expected/caught failure (e.g. the event-bus "one listener fails,
  others continue" test) masqueraded as an uncaught suite error even though every
  test passed. Logging the message keeps the debug signal without the false alarm.
