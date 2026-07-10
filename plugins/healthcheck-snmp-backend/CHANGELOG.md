# @checkstack/healthcheck-snmp-backend

## 0.1.2

### Patch Changes

- @checkstack/healthcheck-common@1.16.2
- @checkstack/backend-api@0.32.1

## 0.1.1

### Patch Changes

- Updated dependencies [bd41130]
  - @checkstack/backend-api@0.32.0
  - @checkstack/healthcheck-common@1.16.1

## 0.1.0

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

- 43e4484: Add an SNMP health-check plugin (strategy id `snmp`, collector id `snmp`) in the
  networking category. It queries a single OID from an SNMP v1 / v2c / v3 agent and
  exposes the returned value (`value` numeric, `valueString` lossless),
  `valueType`, and `responseTimeMs` as assertable metrics. Connection details and
  credentials (community string, v3 auth/priv keys) live on the strategy config as
  extracted secrets. Following the collector contract, only a genuine transport
  failure (unreachable socket, timeout, v3 auth handshake failure) sets `error`;
  returned values and the SNMP exception varbinds (`noSuchObject`,
  `noSuchInstance`, `endOfMibView`) are completed responses you assert on.
  Counter64 values that exceed JS safe-integer range are preserved exactly in
  `valueString` and never crash the collector.

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
