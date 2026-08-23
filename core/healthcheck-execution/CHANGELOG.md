# @checkstack/healthcheck-execution

## 0.35.3

### Patch Changes

- Updated dependencies [68ef4b2]
  - @checkstack/backend-api@0.35.2

## 0.35.2

### Patch Changes

- @checkstack/backend-api@0.35.1

## 0.35.1

### Patch Changes

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
  - @checkstack/common@0.24.0
  - @checkstack/backend-api@0.35.0
  - @checkstack/template-engine@0.4.13

## 0.35.0

### Minor Changes

- be74b01: Expand system/environment custom fields in satellite health checks, via one shared execution engine

  Thanks to @stuajnht for reporting: a system or environment custom field
  referenced with `{{ system.metadata.<key> }}` / `{{ environment.<key> }}` in a
  health check was NOT expanded when the check ran on a satellite - the raw
  template reached the probe. The core queue executor grew a per-run templating
  pass, but the satellite's execution loop was a hand-maintained COPY that never
  did, so the two drifted.

  The fix removes the copy. A new lean package `@checkstack/healthcheck-execution`
  owns the shared execution engine - render the strategy + collector
  `x-templatable` fields against the run's environment/system context, build the
  transport client, run the collectors, close the client - and BOTH the core
  queue executor and the satellite now run through it. Templating, the
  secret-then-template ordering, and the per-collector fan-out therefore cannot
  drift between core and satellite again. Each side keeps only its genuine edges
  as injected hooks: the core resolves secrets from its database and does
  migrate-on-read; the satellite resolves them just-in-time over its socket.

  Also fixed: transport sub-phase timings (DNS / connect / TLS / wait / transfer)
  are now measured AT THE PROBE and reported by satellites, so a satellite run's
  `metadata.timings` matches a local run's. The core cannot derive the timing of a
  probe it did not run - and may have no route to a target a satellite can reach -
  so the satellite must produce these; the core persists them as-is.

### Patch Changes

- @checkstack/backend-api@0.34.1
