---
title: "Packages vs Plugins Architecture"
description: "This document explains the distinction between packages and plugins in the Checkstack monorepo."
---
---
---

# Packages vs Plugins Architecture

This document explains the distinction between **packages** and **plugins** in the Checkstack monorepo.

## Overview

The Checkstack platform uses a two-tier architecture for code organization:

| Directory | Purpose | Examples |
|-----------|---------|----------|
| `core/` | Essential platform components that cannot be removed | Auth, Catalog, Queue, Notifications |
| `plugins/` | Replaceable providers and strategies | Auth providers (GitHub, LDAP), Queue backends (BullMQ) |

## Decision Criteria

Use this guide when deciding where to place new code:

### Create in `core/` when:

- ✅ The platform **depends on this functionality** to operate
- ✅ It provides **core infrastructure** (auth, storage, messaging)
- ✅ It defines **shared contracts** that other components depend on
- ✅ It **cannot be swapped** for an alternative at runtime
- ✅ Removing it would **break the platform**

**Examples:**
- `auth-*`: Authentication is fundamental
- `catalog-*`: Entity management is core to the platform
- `queue-*`: Job queue abstraction layer
- `notification-*`: Platform notifications
- `healthcheck-*`: Platform health monitoring
- `theme-*`: UI theming infrastructure

### Create in `plugins/` when:

- ✅ It's a **provider** or **strategy** implementation
- ✅ It can be **swapped** for an alternative
- ✅ Multiple **implementations can coexist**
- ✅ It's **optional** - platform works without it (with alternatives)
- ✅ It follows a **plugin interface** defined in a package

**Examples:**
- `auth-github-backend`: One of many auth providers
- `auth-ldap-backend`: Alternative auth provider
- `queue-bullmq-backend`: One queue implementation
- `queue-memory-backend`: Alternative queue implementation
- `healthcheck-http-backend`: One health check strategy

## Package Naming Conventions

| Type | Backend | Common (Shared) | Frontend |
|------|---------|-----------------|----------|
| **Package** | `core/{name}-backend` | `core/{name}-common` | `core/{name}-frontend` |
| **Plugin** | `plugins/{name}-backend` | `plugins/{name}-common` | `plugins/{name}-frontend` |

## Architecture Diagram

```
core/
├── backend/           # Core backend server
├── frontend/          # Core frontend app
├── backend-api/       # Backend plugin API
├── frontend-api/      # Frontend plugin API
├── common/            # Shared types/utilities
│
├── auth-backend/      # Core auth service
├── auth-common/       # Auth contracts
├── auth-frontend/     # Auth UI
│
├── catalog-*/         # Entity management
├── notification-*/    # Notifications
├── queue-*/           # Queue abstraction
├── healthcheck-*/     # Health monitoring
├── theme-*/           # UI theming
└── ...

plugins/
├── auth-github-backend/     # GitHub OAuth provider
├── auth-credential-backend/ # Username/password auth
├── auth-ldap-backend/       # LDAP auth provider
│
├── queue-bullmq-backend/    # BullMQ implementation
├── queue-bullmq-common/
├── queue-memory-backend/    # In-memory implementation
├── queue-memory-common/
│
└── healthcheck-http-backend/ # HTTP health strategy
```

## Plugin Interface Pattern

Plugins implement interfaces defined in packages:

```typescript
// core/queue-api/src/types.ts
export interface QueuePlugin {
  type: "queue";
  createQueue(name: string, options: QueueOptions): Queue;
}

// plugins/queue-bullmq-backend/src/index.ts
export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env.registerService(queuePluginRef, {
      type: "queue",
      createQueue: (name, options) => new BullMQQueue(name, options),
    });
  },
});
```

## CLI Scaffolding

When using the CLI to create new code:

```bash
# Create a core package
bun run cli create package auth-oauth

# Create a replaceable plugin
bun run cli create plugin auth-okta-backend
```

The CLI will prompt for confirmation if creating in the "wrong" directory based on naming patterns.
