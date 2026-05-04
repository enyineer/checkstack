---
title: "Kind Registry: Conditional Sub-Schema Documentation"
description: "Date: 2026-04-21 Status: Open Related: Kind Registry Browser (gitops-frontend/src/pages/KindRegistryPage.tsx)"
---
# Kind Registry: Conditional Sub-Schema Documentation

**Date**: 2026-04-21
**Status**: Open
**Related**: Kind Registry Browser (`gitops-frontend/src/pages/KindRegistryPage.tsx`)

## Problem

The Kind Registry page shows the structural YAML format for each entity kind, but generic/dynamic fields like `config` (`z.record()`) render as `{} # key-value pairs` — the actual available fields depend on runtime choices (e.g., which health check strategy is selected).

### Specific Example: Healthcheck Kind

The `Healthcheck` kind has:
- `strategy`: a string like `"postgres"`, `"http"`, `"jenkins"`, etc.
- `config`: a `z.record()` whose actual fields **depend on the chosen strategy**
- `collectors`: an optional array where valid collector IDs and their configs **also depend on the strategy**

The Kind Registry cannot currently show "when strategy=postgres, config expects `{ host, port, database, user, password }`" because:
1. Per-strategy config schemas live in `HealthCheckRegistry`, not in the entity kind registry
2. Per-collector config schemas live in `CollectorRegistry`
3. The relationship is **conditional** — not a flat list of alternatives

### Generalized Problem

This applies to **both** kinds and extensions. Any registered schema (kind or extension) may have dynamic fields whose concrete variants are managed by a separate domain-specific registry.

## Design Considerations

### Option A: `subSchemas` on Kind/Extension Definitions

Add an optional `subSchemas` field to both `EntityKindDefinition` and `EntityKindExtensionDefinition`:

```typescript
subSchemas?: Array<{
  label: string;
  description?: string;
  schema: z.ZodType;
}>;
```

**Pros**: Simple, self-documenting, no cross-registry introspection needed.
**Cons**: Cannot express conditional relationships (e.g., "these collectors are only valid for this strategy"). Results in a flat list that may confuse users.

### Option B: Conditional Sub-Schema Trees

A more structured approach where sub-schemas declare their conditions:

```typescript
subSchemas?: Array<{
  label: string;
  description?: string;
  schema: z.ZodType;
  appliesWhen?: { field: string; value: string }; // e.g., { field: "strategy", value: "postgres" }
  children?: SubSchema[]; // nested conditional schemas (e.g., collectors)
}>;
```

**Pros**: Accurately models the conditional relationship.
**Cons**: Complex to implement, risks over-engineering, may not generalize to other kinds.

### Option C: Link to Domain-Specific Documentation

Instead of embedding all sub-schemas in the Kind Registry, add a `documentationUrl` or `relatedPages` field that links to the existing domain-specific documentation (e.g., the health check strategy listing page).

**Pros**: Zero duplication, leverages existing UIs.
**Cons**: Fragmented documentation experience.

## Recommendation

Start with **Option A** as it covers the majority of use cases. If conditional relationships prove important in practice, evolve to **Option B** later. The current Kind Registry is already useful for understanding the structural YAML format and discovering available kinds/extensions.
