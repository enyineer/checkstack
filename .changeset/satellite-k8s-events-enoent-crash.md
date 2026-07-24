---
"@checkstack/satellite": patch
"@checkstack/k8s-events-common": patch
---

Fix satellite crash-loop on startup (ENOENT reading `@checkstack/k8s-events-common`)

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
