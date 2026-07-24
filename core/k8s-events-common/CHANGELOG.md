# @checkstack/k8s-events-common

## 0.1.1

### Patch Changes

- be74b01: Fix satellite crash-loop on startup (ENOENT reading `@checkstack/k8s-events-common`)

  Thanks to @stuajnht for reporting: satellite releases 134 and 135 crash-loop at
  startup with `error: ENOENT reading ".../@checkstack/k8s-events-common"`, while
  133 works. The k8s-events telemetry pull executor (added in 134) imports
  `@checkstack/k8s-events-common` eagerly at module load, but the satellite Docker
  image pruned it away, so the agent crashed before any check could run.

  Two root causes, both fixed:

  - `k8s-events-common` lived under `plugins/`, unlike its sibling telemetry
    contracts (`metricstream-common`, `logstream-common`, `tracestream-common`),
    which are in `core/`. A `core/` package (the satellite) importing a
    `plugins/` package is a dependency-direction violation; the package now lives
    in `core/` alongside its siblings.
  - The satellite image prune deleted every plugin except the `healthcheck-*` /
    `collector-*` backends by name pattern, which silently dropped any other
    package the satellite needs. The prune is now driven by the dependency graph:
    it keeps the transitive runtime-dependency closure of the satellite plus every
    plugin it loads dynamically at runtime (using those backends as extra roots,
    so they are never pruned by accident). The "which plugins does the satellite
    load" rule is now a single shared predicate consumed by both the runtime
    loader and the build-time prune, so they cannot drift.

  Verified by building `Dockerfile.satellite` and starting the image: it loads all
  15 strategies + 28 collectors, runs the k8s-events executor registration without
  `ENOENT`, and reaches normal core-connection retries instead of crash-looping.

  - @checkstack/telemetry-common@0.1.1

## 0.1.0

### Minor Changes

- 6c8b36b: New Kubernetes events source (`k8s-events.k8s-events`): an interval-pull
  source that lists cluster events from the modern `events.k8s.io/v1` API
  (request shapes verified against the official Kubernetes API reference)
  and ingests them as log records - Warning events as warnings, with the
  event's reason/note as the body and the regarding-object identity,
  reporting controller, and a stable `k8s.event.uid` in the attributes.
  Auth is a service-account bearer token (encrypted at rest, resolved
  just-in-time on satellites); namespace, fieldSelector and labelSelector
  scope the pull. Time-window pulls overlap slightly by design
  (`lookbackSeconds`), so rare duplicates are possible and documented -
  the stable event identity enables future dedupe. Supports satellite
  execution via a statically-linked pull executor.

  `maxEventsPerPull` caps EMITTED in-window records (the list API returns
  events roughly oldest-first, so the scan pages past out-of-window
  backlog to reach recent events); the scan itself is bounded by a
  40-page budget, and a busy cluster that exhausts it yields a partial
  window with an operator warning (core and satellite) recommending a
  namespace or fieldSelector, while a server that pages forever without
  items fails as a transport error.

### Patch Changes

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/telemetry-common@0.1.0
  - @checkstack/common@0.23.0
