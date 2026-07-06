---
"@checkstack/healthcheck-container-common": minor
"@checkstack/healthcheck-container-backend": minor
"@checkstack/backend-api": minor
"@checkstack/healthcheck-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-frontend": minor
---

Add a **Container** health-check strategy for monitoring Docker and Podman
containers that expose no external service of their own. It reports container
existence, running state, healthcheck status, exit code, restart count, and
OOM-killed via the **Container Status** collector, and CPU/memory usage via the
**Container Stats** collector. Both collectors issue only read (GET) requests
against the runtime REST API.

The check runs wherever the executor runs: locally on the core instance (the
default) to watch containers that share a host with Checkstack, or on a
satellite pinned to another host.

Critically, Checkstack never touches the raw container socket. The strategy
talks the Docker Engine / Podman libpod API over either a unix socket path or an
`http(s)` endpoint, so operators point it at a **read-only socket-proxy**
(`lscr.io/linuxserver/socket-proxy` with `POST=0`) running next to whichever
Checkstack instance runs the check - core or a satellite - or at a rootless
Podman socket. The raw socket is mounted only into the proxy; even a compromised
instance can only read container state, never control the host. A stopped or missing container is a successful collection whose metrics
feed assertions (following the transport-failure-vs-metric rule) - only an
unreachable runtime endpoint fails the check. Container `exec` probes are
intentionally not offered because they would require write access to the socket.

To support in-product setup guidance, the health-check strategy contract gains
an optional `setupInstructions` (Markdown) field, surfaced in the DTO and
rendered as a collapsible "Setup guide" callout above the strategy config fields
in the editor. The Container strategy populates it with the secure proxy setup.

The hardened socket-proxy compose is maintained as a single canonical file
(`deploy/socket-proxy/docker-compose.yml`) that operators `include:` from their
core or satellite compose, so the read-only / `POST=0` / internal-network
hardening is defined in exactly one place; the docs and the in-product setup
guide reference it rather than duplicating the YAML.

Also removes a stale hand-written `HealthCheckStrategyDto` interface in
`@checkstack/healthcheck-common` that shadowed (and lagged behind) the
Zod-inferred DTO; the inferred type from `schemas.ts` is now the single source
of truth and correctly carries `resultSchema`, `aggregatedResultSchema`, and the
new `setupInstructions`.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback
that shaped this release.
