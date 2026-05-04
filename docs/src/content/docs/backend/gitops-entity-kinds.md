---
title: "GitOps Entity Kinds"
description: "This guide explains how plugin developers register entity kinds and kind extensions for the GitOps reconciliation system."
---
# GitOps Entity Kinds

This guide explains how plugin developers register entity kinds and kind extensions for the GitOps reconciliation system.

## Overview

The GitOps system lets teams define Checkstack resources (systems, health checks, etc.) as YAML files in Git repositories. Each resource is described by an **entity kind** that defines:

- A **spec schema** (Zod) for validating the YAML descriptor
- A **reconcile** function that creates or updates the resource
- An optional **delete** function for cleanup

Plugins can also **extend** existing kinds by adding namespaced spec fields (e.g., the healthcheck plugin extends `System` with health check assignments).

```
┌─────────────────────────────────────────────────────────────┐
│                     YAML Descriptor                         │
│                                                             │
│  apiVersion: checkstack.io/v1alpha1                         │
│  kind: System                                               │
│  metadata:                                                  │
│    name: payment-api                                        │
│  spec:                                                      │
│    description: Payment processing API                      │
│    healthcheck:               ← extension namespace         │
│      - ref:                                                 │
│          kind: Healthcheck                                  │
│          name: payment-db-check                             │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   ┌────────────┐ ┌────────────┐ ┌────────────┐
   │  Validate  │ │   Sort     │ │ Reconcile  │
   │  envelope  │ │  by deps   │ │  in order  │
   │  + spec    │ │ (topo)     │ │            │
   └────────────┘ └────────────┘ └────────────┘
```

## Descriptor Format

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

## Registering a Kind

Register kinds during your plugin's `register()` phase via the `entityKindExtensionPoint`:

```typescript
// my-plugin-backend/src/index.ts
import { createBackendPlugin } from "@checkstack/backend-api";
import { entityKindExtensionPoint } from "@checkstack/gitops-backend";
import { CHECKSTACK_API_VERSION } from "@checkstack/gitops-common";
import { z } from "zod";

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    const kindRegistry = env.getExtensionPoint(entityKindExtensionPoint);

    kindRegistry.registerKind({
      apiVersion: CHECKSTACK_API_VERSION,
      kind: "System",
      specSchema: z.object({
        // Define the fields that appear under `spec:` in the YAML
      }),

      reconcile: async ({ entity, existingEntityId, context }) => {
        // Create or update the resource in your plugin's database.
        // `entity.spec` is fully validated and typed.
        // `existingEntityId` is set when updating an existing resource.
        //
        // Must return { entityId: string } — the plugin-specific ID.
        const id = existingEntityId ?? await createResource(entity);
        return { entityId: id };
      },

      delete: async ({ entityName, entityId, context }) => {
        // Optional. Called when the entity is removed from Git.
        if (entityId) await deleteResource(entityId);
      },
    });
  },
});
```

### `EntityKindDefinition<TSpec>` Interface

| Property | Type | Description |
|----------|------|-------------|
| `apiVersion` | `string` | API version (e.g., `"checkstack.io/v1alpha1"`) |
| `kind` | `string` | Unique kind name (e.g., `"System"`, `"Healthcheck"`) |
| `specSchema` | `z.ZodType<TSpec>` | Zod schema for the `spec` section |
| `reconcile` | `(params) => Promise<{ entityId }>` | Create/update handler |
| `delete` | `(params) => Promise<void>` | Optional cleanup handler |

### Reconcile Parameters

```typescript
reconcile: async ({
  entity,            // Full envelope (metadata + validated spec)
  existingEntityId,  // Set on updates (from previous reconcile)
  context,           // Logger + resolveEntityRef helper
}) => { ... }
```

### Delete Parameters

```typescript
delete: async ({
  entityName,  // The metadata.name from the removed descriptor
  entityId,    // Plugin-specific ID from provenance (if available)
  context,     // Logger + resolveEntityRef helper
}) => { ... }
```

## Registering a Kind Extension

Extensions let a plugin add namespaced fields to another plugin's kind. For example, the healthcheck plugin extends `System` to allow health check assignments:

```typescript
// healthcheck-backend/src/index.ts
kindRegistry.registerKindExtension({
  apiVersion: CHECKSTACK_API_VERSION,
  kind: "System",
  namespace: "healthcheck",   // Fields appear under spec.healthcheck

  specSchema: z.array(
    z.object({
      ref: entityRefSchema,                             // { kind, name }
      degradedThreshold: z.number().int().min(1).optional(),
      unhealthyThreshold: z.number().int().min(1).optional(),
    }),
  ).optional(),

  reconcile: async ({ entity, extensionSpec, entityId, context }) => {
    // `entityId` is the System's plugin-specific ID (from the base reconciler).
    // `extensionSpec` is the validated data from spec.healthcheck.
    for (const entry of extensionSpec) {
      const configId = await context.resolveEntityRef({
        kind: entry.ref.kind,
        entityName: entry.ref.name,
      });
      if (configId) {
        await assignHealthcheck({ systemId: entityId, configId });
      }
    }
  },
});
```

### `EntityKindExtensionDefinition<TExtensionSpec>` Interface

| Property | Type | Description |
|----------|------|-------------|
| `apiVersion` | `string` | API version of the kind being extended |
| `kind` | `string` | The kind being extended (e.g., `"System"`) |
| `namespace` | `string` | Unique namespace under `spec` (convention: your plugin ID) |
| `specSchema` | `z.ZodType<TExtensionSpec>` | Zod schema for the extension fields (should be `.optional()`) |
| `reconcile` | `(params) => Promise<void>` | Called with the base kind's `entityId` |

### Extension Registration Order

Extensions can be registered **before** the base kind is registered. The registry stores them and merges them once the base kind is registered. This removes cross-plugin load-order dependencies.

## Entity References

Use Kubernetes-style structured references to create dependencies between entities:

```yaml
# A System that references a Healthcheck
apiVersion: checkstack.io/v1alpha1
kind: System
metadata:
  name: payment-api
spec:
  healthcheck:
    - ref:
        kind: Healthcheck        # The kind of the referenced entity
        name: payment-db-check   # The metadata.name of the referenced entity
```

The `entityRefSchema` from `@checkstack/gitops-common` validates these references:

```typescript
import { entityRefSchema } from "@checkstack/gitops-common";

// Use in your spec schema
const mySchema = z.object({
  ref: entityRefSchema,  // { kind: string, name: string }
});
```

### Automatic Dependency Resolution

The reconciliation engine automatically detects entity refs in specs using `extractEntityRefs()`. This walks the entire spec tree and collects all objects matching `{ kind, name }`. These are used to build a dependency graph and reconcile entities in topological order (dependencies first).

**You don't need to do anything special** — just use the `entityRefSchema` in your spec and the engine handles the rest.

## Reconciliation Lifecycle

The GitOps sync engine follows a strict **Collect → Sort → Reconcile** lifecycle:

```
  Git Repository
       │
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Collect    │ ──▶ │    Sort      │ ──▶ │  Reconcile   │
│              │     │              │     │              │
│ Discover all │     │ Topological  │     │ Process each │
│ YAML files,  │     │ sort using   │     │ entity in    │
│ parse and    │     │ entity refs  │     │ dependency   │
│ validate     │     │ (Kahn's alg) │     │ order        │
└──────────────┘     └──────────────┘     └──────────────┘
```

1. **Collect**: All YAML files matching the provider's path pattern are discovered, parsed, and validated against registered spec schemas.

2. **Sort**: Entities are topologically sorted based on their entity refs. If entity A references entity B, B is reconciled first. Cycles are detected and rejected with descriptive error messages.

3. **Reconcile**: Each entity is reconciled in dependency order:
   - The base kind's `reconcile()` is called first, returning an `entityId`.
   - Then each extension's `reconcile()` is called with that `entityId`.
   - Provenance records are created/updated to track the mapping.

### Provenance

Every reconciled entity gets a provenance record linking:
- The Git source (provider, file path, commit)
- The entity kind and name
- The plugin-specific entity ID

This enables:
- **Locking**: Resources managed by GitOps are locked from manual editing in the UI.
- **Orphan detection**: When a YAML file is removed, the orphaned provenance record enables cleanup (automatic or manual, based on the provider's deletion policy).

### Secret References

Use `${{ secrets.NAME }}` template syntax for sensitive values that should be resolved from the GitOps secret store:

```yaml
spec:
  config:
    password: "${{ secrets.my-database-password }}"
    # Also supports inline interpolation:
    connectionString: "postgres://user:${{ secrets.DB_PASS }}@host/db"
```

Secret resolution is **schema-driven** — only fields marked with `configString({ "x-secret": true })` are resolved. This is the same annotation pattern used by DynamicForm for the admin UI:

```typescript
import { configString } from "@checkstack/backend-api";

const postgresConfigSchema = z.object({
  host: configString({}).describe("Hostname"),
  password: configString({ "x-secret": true }).describe("Database password"),
});
```

#### Security Model

Secrets are **not pre-resolved** in the spec. Instead:

1. **Validation**: All referenced secrets are validated to exist at sync time. Missing secrets cause the entity to error immediately.
2. **Metadata guard**: Templates in `metadata` fields (`name`, `title`, `description`) are **rejected** to prevent secrets from leaking into display fields.
3. **Schema-driven resolution**: The plugin reconciler calls `context.resolveSecretsBySchema()` with the **typed schema** (e.g., the strategy config schema). Only fields annotated with `x-secret` are resolved — everything else is returned as-is.

This prevents a malicious actor from exfiltrating secrets via display fields or non-secret config fields.

> **Secret rotation**: When a secret is rotated via the admin UI, all entities referencing that secret are automatically flagged for re-reconciliation on the next sync cycle.

## ReconcileContext

Both kind and extension reconcilers receive a `ReconcileContext`:

```typescript
interface ReconcileContext {
  /** Scoped logger */
  logger: {
    debug: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };

  /**
   * Resolve a GitOps entity name to its plugin-specific ID.
   * Used by extensions to look up cross-kind references.
   */
  resolveEntityRef: (params: {
    kind: string;
    entityName: string;
  }) => Promise<string | undefined>;

  /**
   * Schema-driven secret resolution. Walks the provided Zod schema,
   * finds fields annotated with configString({ "x-secret": true }),
   * and resolves ${{ secrets.NAME }} templates only in those fields.
   */
  resolveSecretsBySchema: <T>(params: {
    value: T;
    schema: z.ZodTypeAny;
  }) => Promise<T>;
}
```

**Usage in a reconciler:**

```typescript
reconcile: async ({ entity, context }) => {
  // Look up the strategy to get its typed schema (with x-secret annotations)
  const strategy = registry.getStrategy(entity.spec.strategy);

  // Resolve secrets using the strategy's schema — only x-secret fields are resolved
  const resolvedConfig = await context.resolveSecretsBySchema({
    value: entity.spec.config,
    schema: strategy.config.schema,
  });

  await createConfiguration({ config: resolvedConfig });
}
```

## Kind Registry Browser

The **Kind Registry** page (accessible from the user menu) provides a live view of all registered kinds, their base spec schemas, extensions, and auto-generated YAML examples. This is useful for:

- Discovering what entity kinds are available
- Understanding the full spec schema (base + extensions)
- Copying YAML examples as a starting point

Access is controlled by the `gitops.kinds.read` access rule (granted to all authenticated users by default).

## Example: Full Kind + Extension Registration

Here is a complete real-world example showing how the catalog and healthcheck plugins cooperate:

**Catalog plugin** registers `kind: System`:

```typescript
// catalog-backend/src/index.ts
kindRegistry.registerKind({
  apiVersion: CHECKSTACK_API_VERSION,
  kind: "System",
  specSchema: z.object({}),

  reconcile: async ({ entity, existingEntityId, context }) => {
    const displayName = entity.metadata.title ?? entity.metadata.name;
    if (existingEntityId) {
      await entityService.updateSystem(existingEntityId, { name: displayName });
      return { entityId: existingEntityId };
    }
    const system = await entityService.createSystem({ name: displayName });
    return { entityId: system.id };
  },

  delete: async ({ entityId }) => {
    if (entityId) await entityService.deleteSystem(entityId);
  },
});
```

**Healthcheck plugin** extends `System` and registers `kind: Healthcheck`:

```typescript
// healthcheck-backend/src/healthcheck-gitops-kinds.ts
kindRegistry.registerKind({
  apiVersion: CHECKSTACK_API_VERSION,
  kind: "Healthcheck",
  specSchema: z.object({
    strategy: z.string().min(1),
    intervalSeconds: z.number().int().min(1),
    config: z.record(z.string(), z.unknown()),
  }),
  reconcile: async ({ entity, existingEntityId, context }) => {
    // Look up strategy — its typed schema carries x-secret annotations
    const strategy = registry.getStrategy(entity.spec.strategy);

    // Resolve secrets using the strategy's schema
    const resolvedConfig = await context.resolveSecretsBySchema({
      value: entity.spec.config,
      schema: strategy.config.schema,
    });
    return { entityId: configId };
  },
});

kindRegistry.registerKindExtension({
  apiVersion: CHECKSTACK_API_VERSION,
  kind: "System",
  namespace: "healthcheck",
  specSchema: z.array(
    z.object({
      ref: entityRefSchema,
      degradedThreshold: z.number().int().min(1).optional(),
      unhealthyThreshold: z.number().int().min(1).optional(),
    }),
  ).optional(),
  reconcile: async ({ extensionSpec, entityId, context }) => {
    // Assign health checks to the system
    for (const entry of extensionSpec) {
      const configId = await context.resolveEntityRef({
        kind: entry.ref.kind,
        entityName: entry.ref.name,
      });
      if (configId) {
        await assignToSystem({ systemId: entityId, configId });
      }
    }
  },
});
```

**Resulting YAML**:

```yaml
apiVersion: checkstack.io/v1alpha1
kind: System
metadata:
  name: payment-api
  title: Payment API
spec:
  healthcheck:
    - ref:
        kind: Healthcheck
        name: payment-db-check
      degradedThreshold: 2
      unhealthyThreshold: 5
---
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

## Other Built-In Kinds and Extensions

Beyond `System` and `Healthcheck`, the following kinds and extensions
are registered by their owning plugins:

### `kind: SLO` (slo-backend)

Reliability targets bound to a system, optionally narrowed to a single
healthcheck. The objective UUID is the entity ID in provenance, so
renames preserve identity.

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

### `kind: Satellite` (satellite-backend)

Metadata-only declaration of remote execution nodes. The bcrypt token
is **never** expressed in YAML — the reconciler discards the random
token issued at creation. Operators retrieve a working token via the
"Reset token" button on the Satellites page. Runtime tags use the
envelope's `metadata.labels` (`Record<string, string>`), so there is no
duplicate `tags` field on the spec.

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

The reconciler adopts pre-existing satellites by `metadata.name` on
first sync, so manually-created satellites are absorbed safely.

### Extension: `Healthcheck.anomaly` (anomaly-backend)

Per-healthcheck anomaly defaults. Replaces the full template-level
`AnomalySettings` record on every reconcile (GitOps is the source of
truth; UI edits to managed entities are blocked).

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

### Extension: `System.dependencies` (dependency-backend)

Declares upstream system dependencies for a system. The reconciler diffs
the declared edges against the persisted ones where this system is the
source, then applies create / update / delete to converge. Refs that
resolve to the source system itself are rejected.

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

The matching UI (system editor drawer + Dependency Map) disables
Add/Edit/Delete for the source system's upstream edges; downstream
edges are gated per-row by the *other* system's lock.

### Extension: `System.anomaly` (anomaly-backend)

Per-assignment anomaly overrides ("exceptions"), keyed by
`healthcheckRef`. Each entry maps to one System ↔ Healthcheck
assignment and its `AnomalySettings` partial.

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

## Troubleshooting

### Kind Not Appearing in Registry

1. Verify your plugin is loaded (check Admin → Plugins)
2. Ensure `entityKindExtensionPoint` is imported from `@checkstack/gitops-backend`
3. Check that `registerKind()` is called in the `register()` phase (not `init()`)

### Extension Not Merging

1. Verify the `apiVersion` and `kind` match the base kind exactly
2. Check that the `namespace` is unique (no other extension uses the same namespace for the same kind)
3. Extension schemas should be `.optional()` so descriptors without the extension still validate

### Reconcile Not Called

1. Verify the provider's path pattern matches your YAML file location
2. Check the Sync Status tab for error messages
3. Ensure the `apiVersion` and `kind` in your YAML match a registered kind

### Dependency Cycle Detected

The reconciler rejects circular entity references. Check the error message for the cycle path and restructure your descriptors to break the cycle.
