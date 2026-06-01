---
title: "GitOps kind reference"
description: "Reference for every entity kind and extension Checkstack ships out of the box, including YAML schemas for System, Healthcheck, SLO, Satellite, and more."
---

This page is the operator reference for the entity kinds Checkstack ships out of the box. Each kind has its own YAML schema and is registered by a built-in plugin. For the plugin-author side - registering your own kinds or extending an existing one - see [GitOps entity kinds](/checkstack/developer-guide/backend/gitops/entity-kinds/).

## Descriptor envelope

All YAML descriptors follow the Kubernetes-inspired envelope format:

```yaml
apiVersion: checkstack.io/v1alpha1    # Required. Must match a registered kind.
kind: System                           # Required. The entity kind name.
metadata:                              # Required. Common fields.
  name: my-system                      # Required. URL-safe identifier (lowercase, hyphens).
  title: My System                     # Optional. Human-readable display name.
  description: A brief description     # Optional.
  labels:                              # Optional. Key-value pairs for filtering.
    team: platform
  tags:                                # Optional. String tags.
    - production
spec:                                  # Kind-specific configuration.
  # ... fields defined by the kind's specSchema
```

## Entity references

Use Kubernetes-style structured references to create dependencies between entities:

```yaml
spec:
  healthcheck:
    - ref:
        kind: Healthcheck        # The kind of the referenced entity
        name: payment-db-check   # The metadata.name of the referenced entity
```

The reconciler builds a dependency graph from these refs and reconciles entities in topological order.

## Secret references

Use `${{ secrets.NAME }}` template syntax for sensitive values that should be resolved from the GitOps secret store. Secrets are only resolved in fields the registering plugin marks as secret in its config schema, so secrets never leak through display fields like `metadata.title`.

```yaml
spec:
  config:
    password: "${{ secrets.my-database-password }}"
    connectionString: "postgres://user:${{ secrets.DB_PASS }}@host/db"
```

When a secret is rotated, all entities referencing it are automatically flagged for re-reconciliation on the next sync cycle.

## Built-in kinds

### `kind: System` (catalog)

Top-level system, the unit of organisation in Checkstack.

```yaml
apiVersion: checkstack.io/v1alpha1
kind: System
metadata:
  name: payment-api
  title: Payment API
spec: {}
```

### `kind: Healthcheck` (healthcheck)

A scheduled health check bound to a strategy and config.

```yaml
apiVersion: checkstack.io/v1alpha1
kind: Healthcheck
metadata:
  name: payment-db-check
spec:
  strategy: postgres
  intervalSeconds: 60
  config:
    host: db.internal
    port: 5432
    database: payments
    user: monitor
    password: "${{ secrets.payment-db-password }}"
```

### `kind: SLO` (slo)

Reliability targets bound to a system, optionally narrowed to a single healthcheck. The objective UUID is the entity ID in provenance, so renames preserve identity.

```yaml
apiVersion: checkstack.io/v1alpha1
kind: SLO
metadata:
  name: payments-availability
spec:
  systemRef: { kind: System, name: payments-api }
  healthcheckRef: { kind: Healthcheck, name: payments-http } # optional
  target: 99.9
  windowDays: 30
  dependencyExclusion: strict # or "self-only"
  excludedDependencyRefs: # optional
    - { kind: System, name: third-party-payments }
  burnRateThresholds: # optional
    warningPercent: 50
    criticalPercent: 80
    fastBurnMultiplier: 5
```

### `kind: Satellite` (satellite)

Metadata-only declaration of remote execution nodes. The bcrypt token is **never** expressed in YAML - the reconciler discards the random token issued at creation. Operators retrieve a working token via the **Reset token** button on the Satellites page. Runtime tags use the envelope's `metadata.labels` (`Record<string, string>`), so there is no duplicate `tags` field on the spec.

```yaml
apiVersion: checkstack.io/v1alpha1
kind: Satellite
metadata:
  name: eu-west-1
  labels:
    tier: prod
    region-group: emea
spec:
  region: eu-west-1
```

The reconciler adopts pre-existing satellites by `metadata.name` on first sync, so manually-created satellites are absorbed safely.

### `kind: Automation` (automation)

Declares an automation - its triggers, conditions, and actions - so the whole workflow lives in Git. The `spec` is the full automation definition (the same shape the visual / YAML editor produces). On reconcile the automation is upserted; reconciled rows are marked GitOps-managed, so the editor shows a lock banner and disables Save / Delete until the change is made in Git.

```yaml
apiVersion: checkstack.io/v1alpha1
kind: Automation
metadata:
  name: jira-on-incident
  title: Open a Jira ticket on incident
  labels:
    group: Incidents # optional: organises the automations list into sections
spec:
  triggers:
    - event: incident.created
  conditions:
    - "trigger.payload.severity == 'critical'"
  actions:
    - id: file_ticket
      action: integration-jira.create_issue
      config:
        connectionId: "prod-jira"
        projectKey: "OPS"
        summary: "{{ trigger.payload.title }}"
  mode: single
  concurrency_scope: automation
```

The `spec` accepts every automation field: `triggers` (with optional `for:` dwells), structured `conditions`, the full action catalog, `mode`, `concurrency_scope`, `max_runs`, `uses_state`, and `state_window_minutes`. Validation is the same `AutomationDefinitionSchema` the editor uses, so a definition that round-trips in the UI is a valid descriptor.

#### Conditions

`conditions` is an array; every entry must pass (logical AND across the array) before the actions run. Each entry is one of: a template string, an `and` / `or` / `not` combinator, or a structured variant (`numeric_state`, `time`, `state`).

```yaml
conditions:
  # Combinator: and / or / not (recursive, nest any condition)
  - and:
      - "health.system.status == 'unhealthy'"
      - or:
          - "trigger.payload.severity == 'critical'"
          - not: "health.system.in_maintenance"

  # numeric_state: compare a numeric value (literal or scope path) to above / below bounds
  - numeric_state:
      value: "health.system.p95_latency_ms"
      above: 500

  # time: on-call / quiet-hours gating via HH:mm bounds and weekday list
  # after > before = overnight window wrapping midnight
  - time:
      after: "22:00"
      before: "06:00"
      weekday: [1, 2, 3, 4, 5]
      timezone: "Europe/Berlin"

  # state: true when the named system entity has been in status for at least `for`
  - state:
      entity: "payments-api"
      status: unhealthy
      for: { minutes: 30 }
```

> [!NOTE]
> The system referenced by a `state` condition's `entity` (and any system a `numeric_state` path reads via `health.systems[id]`) must be resolved into scope. It is the trigger's context system by default; list additional system ids in `spec.uses_state` for cross-system rules.

For full per-variant semantics - including overnight window wrapping, scope path resolution, and dwell behaviour - see the [Automation primitives reference](/checkstack/developer-guide/backend/automations/primitives/) (Conditions section).

The polymorphic config blocks document themselves in the editor: each `triggers[].config` shows the schema for the chosen `triggers[].event`, and each `actions[].config` shows the schema for the chosen `actions[].action`. The same per-variant docs appear in the Kind Registry Browser, so you can discover the exact fields a trigger or provider action expects without leaving the UI.

The optional `metadata.labels.group` label sets the automation's grouping label (the same field as the UI group picker), which organises the automations list into collapsible sections. It is a row-level field, not part of the `spec` definition. Omit it (or leave it blank) to keep the automation in the implicit "Ungrouped" bucket.

## Built-in extensions

Extensions add namespaced fields to an existing kind. They appear under `spec.<namespace>:` in the descriptor.

### `Healthcheck.anomaly` (anomaly)

Per-healthcheck anomaly defaults. Replaces the full template-level `AnomalySettings` record on every reconcile (GitOps is the source of truth; UI edits to managed entities are blocked).

```yaml
apiVersion: checkstack.io/v1alpha1
kind: Healthcheck
metadata: { name: payment-db-check }
spec:
  # …strategy / intervalSeconds / config…
  anomaly:
    enabled: true
    sensitivity: 1
    confirmationWindow: 3
    baselineWindow: "7d"
    notify: true
    driftEnabled: true
    driftThreshold: 2
    fieldOverrides: # keyed by result field path
      latencyMs: { sensitivity: 0.5, driftThreshold: 4 }
```

### `System.healthcheck` (healthcheck)

Bind health checks to a system, with optional threshold and notification overrides.

```yaml
apiVersion: checkstack.io/v1alpha1
kind: System
metadata: { name: payment-api }
spec:
  healthcheck:
    - ref: { kind: Healthcheck, name: payment-db-check }
      degradedThreshold: 2
      unhealthyThreshold: 5
      notificationPolicy:
        suppressDeEscalations: true
```

The `notificationPolicy` block is per assignment - different checks on the
same system are fully independent. Any field omitted falls back to the
platform default.

`suppressDeEscalations` skips notifications for transitions to a better
(but still non-healthy) state.

> [!NOTE]
> Flapping thresholds are no longer part of `notificationPolicy`. Flapping is
> detected in the automation engine by the trigger `window:` rate gate over
> the `healthcheck.system_health_changed` event (`count` / `minutes`), so the
> threshold lives next to the automation that reacts to it. See
> [Build auto-incident automations](/checkstack/user-guide/guides/customise-auto-incident/).
> A persisted `flappingTrigger` key on an old policy is ignored on read.

### `System.dependencies` (dependency)

Declares upstream system dependencies. The reconciler diffs the declared edges against the persisted ones where this system is the source, then applies create / update / delete to converge. Refs that resolve to the source system itself are rejected.

```yaml
apiVersion: checkstack.io/v1alpha1
kind: System
metadata: { name: payments-api }
spec:
  dependencies:
    - targetRef: { kind: System, name: payments-db }
      impactType: critical # informational | degraded | critical
      transitive: false # follow multi-hop chains?
      label: "primary store" # optional
```

The Dependency Map UI disables Add/Edit/Delete for the source system's upstream edges; downstream edges are gated per-row by the *other* system's lock.

### `System.anomaly` (anomaly)

Per-assignment anomaly overrides ("exceptions"), keyed by `healthcheckRef`. Each entry maps to one System to Healthcheck assignment and its `AnomalySettings` partial.

```yaml
apiVersion: checkstack.io/v1alpha1
kind: System
metadata: { name: payment-api }
spec:
  anomaly:
    - healthcheckRef: { kind: Healthcheck, name: payment-db-check }
      enabled: false
      fieldOverrides:
        latencyMs: { sensitivity: 0.3 }
```

## Kind Registry Browser

The **Kind Registry** page (accessible from the user menu) provides a live view of every registered kind on your instance, with the merged base + extension schema and an auto-generated YAML example. Use it to discover what kinds are available on your install, including those from third-party plugins.

## See also

- [GitOps entity kinds (developer)](/checkstack/developer-guide/backend/gitops/entity-kinds/) - registering custom kinds and extensions as a plugin author.
