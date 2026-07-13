---
"@checkstack/logstream-common": minor
"@checkstack/logstream-backend": minor
---

Add the `pattern-metric` health collector, custom-pattern API handlers, and
referenced-pattern protection to the log-stream backend (v2 health + API).

- **`pattern-metric` collector**: assert on the numeric `<*>` wildcard values
  of one Drain pattern (`avgValue` / `minValue` / `maxValue` / `sampleCount`)
  over the same complete-minute window as `window-metrics`. Values carry no
  unit (the logged number's domain is unknown) and a zero-sample window reports
  zeroed values, so pair a value threshold with `sampleCount > 0`. Follows the
  collector rule (only a DB read failure throws). A collector-DTO conformance
  test (mirroring the strategy-DTO guard) covers all three collectors so an
  enum-ish registration value can never 500 the collector picker.

- **`maskLine` proc** (read-gated on the stream): mask a raw log line into its
  Drain template so the pattern builder can seed its chips from a pasted line in
  the exact backend mask space, instead of re-implementing the masker in the
  browser (which would drift from ingest classification).

- **Custom-pattern handlers** (`createPattern` / `deletePattern` /
  `testPattern` / `listPatternVariables`): create a user-authored pattern
  (`origin: 'user'`, drain-consistent `sha256(streamId + ' ' + template)` id,
  all-wildcard templates rejected). Creating a template that Drain has ALREADY
  mined PROMOTES the mined row in place to `origin: 'user'` (keeping its counts
  and first/last-seen) rather than dead-ending, so "Create pattern from this
  line" always works; a second create of an existing USER template still 409s.
  User patterns are capped per stream (`MAX_USER_PATTERNS_PER_STREAM = 200`,
  enforced atomically inside the create transaction) since each is a protected,
  never-evicted cluster on every pod - past the cap the create returns a
  friendly, actionable 4xx. Delete only user patterns (mined patterns are
  refused, and a delete is refused with a 409 naming the health checks that
  still reference the pattern), dry-run a template against the newest raw lines
  with the drain-consistent matcher, and summarize each wildcard position's
  recent numeric samples + numeric share for the pattern-metric variable picker
  (reading BOTH the minute and hourly tiers so a pattern quiet past
  `minuteRetentionHours` keeps its sample hints). `listPatterns` orders
  user-authored patterns first (then by recency) so a quiet-but-pinned user
  pattern never sinks below the picker's page of chatty mined ones. Pattern
  templates are length-bounded to the ingest line ceiling, and a stream's
  `severityRules` (`valueMap` entries, `patternOverrides`) are count-bounded.

- **Referenced-pattern protection**: retention no longer deletes a quiet
  pattern that is `origin: 'user'` OR referenced by a `pattern-occurrence` /
  `pattern-metric` collector, and the daily cleanup resolves the referenced set
  per stream (skipping the stale-pattern sweep for a stream when that lookup
  fails, rather than risk deleting a referenced pattern). Pattern-variable
  minute buckets now roll up to hourly and expire with the pattern buckets.

- **Assertable-field label clarity**: every assertable result field across the
  three collectors now reads unambiguously in the assertion builder
  (`Since Last Seen` → `Minutes since last seen`, `Since Last Log` →
  `Seconds since last log`, band counts as `... lines`) with zod `.describe()`
  text stating each field's unit and never-seen fallback. Field keys are
  unchanged, so existing assertions and stored results round-trip as-is.
