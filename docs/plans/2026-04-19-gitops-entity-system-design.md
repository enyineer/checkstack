# GitOps Entity System Design

## Overview

This document defines the architecture for Checkstack's GitOps integration — a system that allows users to manage platform entities (systems, groups, healthchecks, etc.) declaratively via YAML descriptors stored in Git repositories.

The design is inspired by Backstage's Software Catalog but adapted to Checkstack's existing plugin architecture. Rather than replacing the catalog, the GitOps system provides a **generic Entity Kind Registry** that plugins register with. The catalog becomes a consumer of the entity system alongside other plugins.

## Core Concepts

### Entity Envelope

All YAML descriptors share a common envelope schema. The `spec` section is kind-specific and validated per registered kind.

```yaml
apiVersion: checkstack.io/v1alpha1    # versioned API, required
kind: System                          # registered kind, required
metadata:
  name: payment-service               # url-safe, [a-z0-9][a-z0-9-]*, max 63 chars, required
  title: Payment Service              # optional human-readable display name
  description: Handles payments       # optional
  labels:                             # optional, key-value for filtering
    team: platform
    tier: critical
  annotations:                        # optional, key-value for machine-readable data
    pagerduty.com/service-id: PD12345
  tags:                               # optional, string array for categorization
    - production
    - payments
spec:
  # Kind-specific fields, owned by the registering plugin
  # + namespaced extension fields from other plugins
```

**Key constraints:**
- `metadata.name` is the unique identifier per kind: `[a-z0-9][a-z0-9-]*`, max 63 characters
- `metadata.title` is a separate human-readable display name (spaces/casing allowed)
- `metadata.namespace` is intentionally omitted — can be added later if multi-tenancy is needed
- Multi-document YAML files are supported (multiple entities separated by `---`)

### Entity Kind Registry

Plugins register entity kinds via an **Extension Point** during the `register()` phase. This mirrors how healthcheck strategies and integration events are registered.

```typescript
// gitops-common — Extension point definition
export const entityKindExtensionPoint = createExtensionPoint<EntityKindRegistry>(
  "gitops.entity-kind-registry"
);

export interface EntityKindRegistry {
  /** Register a new entity kind (e.g., catalog registers "System") */
  registerKind(def: EntityKindDefinition): void;

  /** Extend an existing kind's spec (e.g., healthcheck extends "System") */
  registerKindExtension(def: EntityKindExtensionDefinition): void;
}
```

### Kind Registration (Owning Plugin)

The plugin that owns a kind defines its base spec schema and reconciliation logic:

```typescript
// catalog-backend register():
const registry = env.getExtensionPoint(entityKindExtensionPoint);
registry.registerKind({
  apiVersion: "checkstack.io/v1alpha1",
  kind: "System",
  specSchema: z.object({
    description: z.string().optional(),
  }),
  reconcile: async ({ entity, context }) => {
    // Create or update via local DB
    // entity.spec is fully resolved (secrets replaced)
  },
  delete: async ({ entityName, context }) => {
    // Remove the entity from local DB
  },
});
```

### Kind Extension (Cross-Plugin)

Plugins can extend another plugin's kind by adding namespaced spec fields:

```typescript
// healthcheck-backend register():
registry.registerKindExtension({
  apiVersion: "checkstack.io/v1alpha1",
  kind: "System",
  namespace: "healthchecks",       // → spec.healthchecks.*
  specSchema: z.array(z.object({
    ref: z.string(),               // reference to a Healthcheck entity
    degradedThreshold: z.number().optional(),
    unhealthyThreshold: z.number().optional(),
  })).optional(),
  reconcile: async ({ entity, extensionSpec, context }) => {
    // extensionSpec = the validated healthchecks slice only
    // Resolve refs and create system↔healthcheck associations
  },
});
```

At init time, the GitOps engine merges all extensions into the base spec schema per kind. Validation uses the merged schema, but each reconciler only receives its own slice.

### Entity References

Entities reference each other by name. Healthchecks are their own entity kind and reference systems:

```yaml
apiVersion: checkstack.io/v1alpha1
kind: Healthcheck
metadata:
  name: payment-db-check
spec:
  strategy: postgres
  system: payment-service          # references a System entity by name
  connection:
    host: db.internal
    password: "${{ secrets.prod-db-pass }}"
---
apiVersion: checkstack.io/v1alpha1
kind: System
metadata:
  name: payment-service
spec:
  description: Handles payments
  healthchecks:                       # extension from healthcheck plugin
    - ref: payment-db-check           # reference to Healthcheck entity
      degradedThreshold: 3
      unhealthyThreshold: 5
```

## Secret Management

### Secret Store (`secret-backend`)

A simple encrypted key-value store for secrets referenced in YAML descriptors via `${{ secrets.NAME }}` template syntax. Secrets are AES-256-GCM encrypted at rest, with the encryption key provided via environment variable.

```typescript
// secret-backend schema
export const secrets = pgTable("secrets", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  encryptedValue: text("encrypted_value").notNull(),
  iv: text("iv").notNull(),
  description: text("description"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

### `${{ secrets.NAME }}` Template Syntax

Secrets can be referenced in any string field using template expressions:

```yaml
password: "dev-password"                           # plain string (dev/testing)
password: "${{ secrets.production-db-creds }}"     # resolved from secret store
connectionString: "postgres://user:${{ secrets.DB_PASS }}@host/db"  # inline interpolation
```

### Automatic Secret Resolution

The GitOps reconciliation engine resolves all `${{ secrets.NAME }}` templates **before** calling a plugin's reconciler. Plugin authors never handle secret resolution manually — just use `z.string()` or `z.unknown()`:

```typescript
registry.registerKind({
  kind: "Healthcheck",
  specSchema: z.object({
    strategy: z.string(),
    config: z.record(z.string(), z.unknown()), // generic record
  }),
  reconcile: async ({ entity, context }) => {
    // The generic specSchema doesn't carry x-secret annotations, but the
    // strategy's typed schema does (e.g., password: configString({ "x-secret": true })).
    const strategy = registry.getStrategy(entity.spec.strategy);
    const resolvedConfig = await context.resolveSecretsBySchema({
      value: entity.spec.config,
      schema: strategy.config.schema, // typed schema with x-secret annotations
    });
    // resolvedConfig.password is now the actual secret value;
    // non-secret fields are returned as-is
  },
});
```

> **Security**: Resolution is **schema-driven** — only fields annotated with `configString({ "x-secret": true })` are resolved. Templates in `metadata` fields are **rejected** at sync time. Secrets are never pre-resolved into the spec, preventing leaks through display fields like `description`.

### Secret Rotation & Invalidation

When a secret is rotated via the admin UI, all provenance entries referencing that secret are invalidated (their `lastSyncHash` is cleared). The next sync cycle will re-reconcile these entities with the new secret value. Referenced secret names are tracked as a Postgres `text[]` array on the provenance table.

### Provider Auth vs. Descriptor Secrets

| Secret type | Storage mechanism |
|---|---|
| Provider auth tokens (GitHub/GitLab API) | DynamicForm secret fields (encrypted at rest, like notification strategies) |
| Values referenced via `${{ secrets.NAME }}` in descriptors | Secret store (`secret-backend`) |

Provider configuration uses DynamicForm's built-in secret field support, consistent with how auth strategies and notification strategies already work.

## GitOps Providers & Discovery

### Provider Configuration

GitOps providers are configured via the admin UI using DynamicForm and stored in the gitops-backend's database:

- **Type**: GitHub / GitLab
- **Target**: `"my-org"` (org-wide) or `"my-org/my-repo"` (single repo)
- **Path Pattern**: `.checkstack/**/*.yaml` (glob via `minimatch`)
- **Auth**: DynamicForm secret field for API token
- **Sync Interval**: Configurable (e.g., 5m, 15m, 1h)
- **Deletion Policy**: `"orphan"` (default) or `"auto"`

### Scraper Strategies

Each provider type has a scraper implementation:

**GitHub scraper:**
1. Enumerate repos: `/orgs/{target}/repos` with pagination (fallback to `/users/{target}/repos`)
2. Resolve default branch from repo metadata (no hardcoded `main`)
3. Walk file tree via Git Trees API, filter with `minimatch`
4. Fetch matching file contents

**GitLab scraper:**
1. Enumerate projects: `/api/v4/groups/{target}/projects?include_subgroups=true` with pagination
2. Resolve default branch from project metadata
3. Walk recursive tree API, filter with `minimatch`
4. Fetch matching file contents

### Sync Loop

Runs as a recurring queue job (using the existing `queueManager`):

```
┌──────────────────────────────────────────────────────┐
│  Sync Cycle (per provider, on configured interval)   │
├──────────────────────────────────────────────────────┤
│ 1. Scrape: Discover YAML files from git provider     │
│ 2. Parse: YAML → entity envelopes (multi-doc aware)  │
│ 3. Validate: envelope + merged kind spec schema      │
│ 4. Resolve: ${{ secrets.NAME }} templates from store │
│ 5. Diff: Compare against provenance table            │
│    • New entity → call kind reconciler (create)      │
│    • Changed entity → call kind reconciler (update)  │
│    • Missing entity → orphan or delete (per policy)  │
│ 6. Update provenance table with sync state           │
└──────────────────────────────────────────────────────┘
```

**Diffing** uses a content hash of the raw YAML per entity. If the hash matches the provenance table's `lastSyncHash`, reconciliation is skipped.

**Error handling**: If a single descriptor fails validation or reconciliation, it's logged with the error and marked as failed in the provenance table. The sync continues for remaining entities.

## Provenance Tracking

### Centralized Provenance Table

The GitOps backend maintains a provenance mapping table in its own database schema:

```typescript
export const provenance = pgTable("provenance", {
  id: text("id").primaryKey(),
  apiVersion: text("api_version").notNull(),
  kind: text("kind").notNull(),
  entityName: text("entity_name").notNull(),
  providerId: text("provider_id").notNull().references(() => providers.id),
  repository: text("repository").notNull(),
  filePath: text("file_path").notNull(),
  lastSyncHash: text("last_sync_hash").notNull(),
  status: text("status").notNull(),  // "synced" | "error" | "orphaned"
  errorMessage: text("error_message"),
  lastSyncedAt: timestamp("last_synced_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
// Unique constraint on (kind, entityName) — one provenance per entity
```

### Provenance Locking

Entity editor pages query `gitopsClient.getProvenance({ kind, name })`. If the entity is GitOps-managed, the editor shows a read-only banner:

> *"This entity is managed by GitOps (repo: org/repo, file: .checkstack/systems.yaml). Edit the source file to make changes."*

No schema changes needed in consuming plugins — provenance is fully centralized.

### Deletion Policy

Configurable per provider:

- **`orphan`** (default): Missing entities are marked as "orphaned" in the provenance table. Admins confirm deletion via the GitOps dashboard.
- **`auto`**: Missing entities are immediately deleted by calling the kind's `delete` reconciler.

## Frontend

### GitOps Settings Page (Admin)

- **Providers tab**: Add/edit/remove GitOps providers using DynamicForm (type, target, path pattern, sync interval, deletion policy, auth token)
- **Secrets tab**: Manage named secrets for `${{ secrets.NAME }}` usage in descriptors (create, view names, rotate values — values never displayed after creation, usage lookup shows referencing entities)

### GitOps Dashboard

- Per-provider sync status (last sync time, next sync, error count)
- Entity list with status badges: ✅ synced, ⚠️ error (with message), 👻 orphaned
- Orphan management: confirm deletion or dismiss orphan status

### Provenance Integration

Entity detail pages across the platform (catalog system detail, healthcheck config, etc.) show a read-only banner for GitOps-managed entities, preventing manual edits that would be overwritten on the next sync.

## Package Structure

```
core/
├── gitops-common/       # Entity envelope schema, secret template utilities,
│                        # extension point type, RPC contract, access rules,
│                        # provenance types
├── gitops-backend/      # Kind registry, reconciliation engine, provider scrapers,
│                        # provenance table, sync worker, secret resolution
├── gitops-frontend/     # Provider management UI, sync dashboard, orphan management
├── secret-common/       # Secret store RPC contract, types
├── secret-backend/      # Encrypted KV store, secret management API
└── secret-database-backend/  # (existing empty shell — evaluate if needed)
```

## Implementation Phases

### Phase 1: Foundation (no UI, no scrapers)
1. `gitops-common` — Entity envelope schema, `${{ secrets.NAME }}` template utilities, extension point type, RPC contract, access rules
2. `secret-backend` + `secret-common` — Secret store (encrypted KV), RPC contract for resolving secrets
3. `gitops-backend` — Kind registry implementation, reconciliation engine (with secret resolution), provenance table, provider DB schema

### Phase 2: Providers & Sync
4. GitHub scraper (org discovery, default branch, file tree walking, `minimatch`)
5. GitLab scraper (group projects, recursive tree)
6. Sync worker (recurring queue job, diff engine, error tracking)

### Phase 3: First Consumers
7. `catalog-backend` registers `kind: System` and `kind: Group`
8. End-to-end test: YAML descriptor → scraped → validated → reconciled into catalog

### Phase 4: Frontend
9. `gitops-frontend` — Provider management, sync dashboard, orphan management
10. Provenance locking in catalog-frontend (read-only banner for GitOps-managed entities)

### Phase 5: Ecosystem
11. `healthcheck-backend` registers `kind: Healthcheck` + extends `kind: System`
12. Other plugins follow the pattern

Each phase is independently shippable and testable.
