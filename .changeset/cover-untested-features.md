---
"@checkstack/healthcheck-http-backend": patch
"@checkstack/ui": patch
"@checkstack/catalog-frontend": patch
"@checkstack/satellite-backend": patch
---

Cover the features that shipped on logic-only tests

Inline mentions shipped completely inert while ~90 unit tests passed, because
those tests proved the pure functions and nothing proved the render path. Four
features carried exactly the same shape of coverage. Each now has a guard that
was VERIFIED to fail when the thing it guards is broken.

- **HTTP proxy.** `fetch({ proxy })` had never run: every test covered the URL
  we build, the SSRF host we guard and the field contracts, but no test routed a
  request through an actual proxy. A real proxy server now proves the request
  arrives there, that credentials are sent, that a 407 is a COMPLETED request
  (not a transport failure), that an unreachable proxy IS a transport failure,
  and that an empty templated proxy falls back to a direct connection.
- **Status-coloured timeline dots.** The feature was `StatusUpdateTimeline`
  forwarding a caller's `renderDot`; the colour helpers were tested but the
  one-line forward was not. Now pinned, including per-item independence and the
  newest-first ordering a dot renderer must not assume away.
- **System custom-field preview.** `SystemPreviewPicker` had no render coverage
  at all. Now covers the empty case, that the SELECTION is displayed, and that
  "No system" reports `null` rather than leaking the internal sentinel.
- **Per-satellite offline threshold.** `computeStatus` is called from five
  places and a site that forgets the per-satellite value silently falls back to
  the global default, so the admin list, the entity read and the monitor
  disagree about the same satellite. A behavioural drift guard now drives the
  real reads with a heartbeat stale by the global default but fresh by the
  satellite's own threshold - and the shorter-threshold direction too.

Tests only; no runtime behaviour changes.
