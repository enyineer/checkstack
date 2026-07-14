---
"@checkstack/telemetry-backend": minor
"@checkstack/logstream-backend": minor
"@checkstack/metricstream-backend": minor
"@checkstack/telemetry-frontend": minor
---

Add the multi-signal binding editor and a global Sources management page.

- The telemetry sink contract gains an optional `listBindableStreams({ user })`
  method: the owning plugin lists its streams and FILTERS them to the ones the
  caller may manage, so the binding editor only offers streams a bind will
  accept. logstream and metricstream implement it through the shared
  `createStreamBindAuthorizer` factory (service bypass, global rule, then a
  per-resource team-grant filter via `auth.listAccessibleObjectIds`), keeping
  the authorization rule in one place. A sink without the method yields an empty
  picker, so adoption is incremental.
- The frontend add/edit dialogs route each emitted signal through a per-signal
  stream picker: at most one stream per signal, at least one binding overall, a
  signal may be left unrouted, and a bound-but-no-longer-listable stream stays
  visible as a synthetic option. The single-signal fast path (opened from a
  stream section) collapses to the embedding-stream preset with no extra
  interaction.
- A new global Sources page (Reliability nav group) lists every source instance
  the caller may read with per-row enable/edit/rotate/delete gating, and "Add
  source" opens the full catalog with no preset binding.
