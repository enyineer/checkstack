# @checkstack/healthcheck-container-backend

## 0.2.7

### Patch Changes

- @checkstack/healthcheck-common@1.19.2
- @checkstack/backend-api@0.35.1

## 0.2.6

### Patch Changes

- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [88f4333]
- Updated dependencies [1deaac5]
  - @checkstack/common@0.24.0
  - @checkstack/healthcheck-common@1.19.1
  - @checkstack/backend-api@0.35.0
  - @checkstack/healthcheck-container-common@0.1.3

## 0.2.5

### Patch Changes

- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
- Updated dependencies [be74b01]
  - @checkstack/healthcheck-common@1.19.0
  - @checkstack/backend-api@0.34.1

## 0.2.4

### Patch Changes

- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
- Updated dependencies [6c8b36b]
  - @checkstack/backend-api@0.34.0
  - @checkstack/healthcheck-common@1.18.0
  - @checkstack/common@0.23.0
  - @checkstack/healthcheck-container-common@0.1.2

## 0.2.3

### Patch Changes

- Updated dependencies [a74fa01]
- Updated dependencies [4568dcc]
- Updated dependencies [d00e099]
  - @checkstack/healthcheck-common@1.17.0
  - @checkstack/backend-api@0.33.0
  - @checkstack/common@0.22.0
  - @checkstack/healthcheck-container-common@0.1.1

## 0.2.2

### Patch Changes

- @checkstack/healthcheck-common@1.16.2
- @checkstack/backend-api@0.32.1

## 0.2.1

### Patch Changes

- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0
  - @checkstack/healthcheck-common@1.16.1

## 0.2.0

### Minor Changes

- 43e4484: Extend `{{ … }}` environment templating across every built-in health-check type
  and add editor UX for it, so one check config can cover N environments (mirrors
  the existing HTTP `url` pattern).

  Templatable connection/target fields now marked `x-templatable`:

  - TLS: `host`, `servername`; TCP: `host`; Ping: `host`; gRPC: `host`, `service`.
  - MySQL / Postgres: `host`, `database`, `user`, `query`.
  - SSH: `host`, `username`, `command`; Redis: `host`, `args`; RCON: `host`,
    `command`.
  - DNS: `hostname`, `nameserver`; Jenkins: `url` (`baseUrl`), `jobName`;
    Container: `endpoint`, `container`.
  - SNMP: `host` (strategy), `oid` (collector).
  - Script (shell): `cwd` (working directory).

  This closes the last gaps so the coverage is now truly every built-in
  health-check type. The Script collectors' `script` bodies are deliberately NOT
  templatable: rendering `{{ … }}` into shell/TypeScript source would splice env
  values into executed code. Per-environment data reaches those scripts safely via
  the reserved `CHECKSTACK_ENV_*` shell vars (shell collector) and
  `globalThis.context.environment` (inline collector) instead.

  Because templating strips `{{ }}` and renders an undefined variable to an empty
  string, every REQUIRED templatable field now has a post-render config-error
  guard so an empty/invalid render is treated as a transport failure instead of a
  silent "healthy" empty probe. Strategy connection fields (host, database, user,
  endpoint, container, Jenkins base URL, SNMP host) throw from `createClient`;
  collector target fields (query, command, hostname, jobName, SNMP oid) return a
  `CollectorResult` with an `error`. Jenkins `baseUrl` moves its `.url()` validation to post-render.
  Secret fields (passwords/tokens/keys) are never templatable; optional fields
  (SNI `servername`, gRPC `service`, DNS `nameserver`, Redis `args`, Script `cwd`)
  are templatable but not non-empty-guarded, since an empty render is a legitimate
  "unset". SSRF/egress guards continue to run on the rendered host (rendering
  happens before `createClient`).

  Editor UX (`@checkstack/ui` + `@checkstack/healthcheck-frontend`):

  - The environment "Preview as" picker + live preview line now also apply to the
    strategy (connection) form, not just collector forms, so host/port templates
    preview too.
  - A single-line templatable field shows a small "Templating" badge next to its
    label and, when a completion provider is supplied, renders a
    `TemplateValueInput` with `{{ … }}` autocomplete. The health-check editor
    seeds the provider with the fixed `environment.* / check.* / system.*`
    namespace (`createReferenceCompletionProvider`, new `@checkstack/ui` export),
    and `DynamicForm` gains a `templatableFieldsOnly` prop so only `x-templatable`
    fields become template inputs (automation keeps templating every string field).

  BREAKING CHANGE: none. Existing non-templatable configs and stored values are
  unaffected; only fields explicitly marked `x-templatable` change behavior.

  The `@checkstack/ai-backend` bump reflects the regenerated docs index for the
  updated health-check collector and config-schema templating documentation.

  Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.

### Patch Changes

- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
- Updated dependencies [43e4484]
  - @checkstack/healthcheck-common@1.16.0
  - @checkstack/backend-api@0.31.1

## 0.1.1

### Patch Changes

- Updated dependencies [8aae4e2]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [d0eddc9]
- Updated dependencies [d0eddc9]
- Updated dependencies [8aae4e2]
- Updated dependencies [d0eddc9]
- Updated dependencies [f93ee7a]
  - @checkstack/healthcheck-common@1.15.0
  - @checkstack/common@0.22.0
  - @checkstack/backend-api@0.31.0
  - @checkstack/healthcheck-container-common@0.1.1

## 0.1.0

### Minor Changes

- 390d9cf: Add a **Container** health-check strategy for monitoring Docker and Podman
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

### Patch Changes

- Updated dependencies [390d9cf]
- Updated dependencies [fc64fad]
- Updated dependencies [9d30324]
  - @checkstack/healthcheck-container-common@0.1.0
  - @checkstack/backend-api@0.30.0
  - @checkstack/healthcheck-common@1.14.0
