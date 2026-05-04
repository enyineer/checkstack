---
title: "Integration Events"
description: "This guide explains how domain plugins expose their hooks as integration events for external webhook subscriptions."
---
# Integration Events

This guide explains how domain plugins expose their hooks as integration events for external webhook subscriptions.

## Overview

Integration events bridge platform hooks to external systems. When a domain plugin emits a hook (e.g., `incident.created`), the integration system can deliver that event to configured webhooks, Slack channels, or other external services.

## How Hooks Become Integration Events

```
┌─────────────────────────────────────────────────────────────────┐
│                     Domain Plugin                               │
│                                                                 │
│  1. Define Hook      2. Emit Hook        3. Register as Event  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ createHook() │ -> │ emitHook()   │ -> │ registerEvent│      │
│  │              │    │              │    │ (at startup) │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Integration Backend                           │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ Event        │ -> │ Hook         │ -> │ Delivery     │      │
│  │ Registry     │    │ Subscriber   │    │ Coordinator  │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   External Systems                              │
│           (Webhooks, Slack, Jira, PagerDuty, etc.)             │
└─────────────────────────────────────────────────────────────────┘
```

## Step-by-Step: Exposing a Hook as an Integration Event

### Step 1: Define the Hook (if not already defined)

Hooks are defined in your plugin's `hooks.ts`:

```typescript
// src/hooks.ts
import { createHook } from "@checkstack/backend-api";

export const incidentHooks = {
  incidentCreated: createHook<{
    incidentId: string;
    systemIds: string[];
    title: string;
    severity: string;
  }>("incident.created"),

  incidentResolved: createHook<{
    incidentId: string;
    systemIds: string[];
  }>("incident.resolved"),
} as const;
```

### Step 2: Emit the Hook When Events Occur

In your router or service, emit the hook when the relevant action happens:

```typescript
// src/router.ts
import { incidentHooks } from "./hooks";

// Inside an RPC handler
const router = os.router({
  createIncident: publicProcedure
    .input(...)
    .mutation(async ({ ctx, input }) => {
      // Create the incident
      const incident = await db.insert(incidents).values(input).returning();

      // Emit the hook - this triggers integration events!
      await ctx.emitHook(incidentHooks.incidentCreated, {
        incidentId: incident.id,
        systemIds: incident.systemIds,
        title: incident.title,
        severity: incident.severity,
      });

      return incident;
    }),
});
```

### Step 3: Register the Hook as an Integration Event

In your plugin's `index.ts`, register the hook with the integration extension point:

```typescript
// src/index.ts
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { integrationEventExtensionPoint } from "@checkstack/integration-backend";
import { z } from "zod";
import { incidentHooks } from "./hooks";
import { pluginMetadata } from "./plugin-metadata";

// Define Zod schemas for payload validation and JSON Schema generation
const incidentCreatedPayload = z.object({
  incidentId: z.string(),
  systemIds: z.array(z.string()),
  title: z.string(),
  severity: z.string(),
});

const incidentResolvedPayload = z.object({
  incidentId: z.string(),
  systemIds: z.array(z.string()),
});

export default createBackendPlugin({
  metadata: pluginMetadata,
  
  register(env) {
    // Get the integration extension point
    const integrationEvents = env.getExtensionPoint(
      integrationEventExtensionPoint
    );

    // Register hooks as integration events
    integrationEvents.registerEvent(
      {
        hook: incidentHooks.incidentCreated,
        displayName: "Incident Created",
        description: "Fires when a new incident is created",
        category: "Incidents",
        payloadSchema: incidentCreatedPayload,
      },
      pluginMetadata
    );

    integrationEvents.registerEvent(
      {
        hook: incidentHooks.incidentResolved,
        displayName: "Incident Resolved",
        description: "Fires when an incident is marked as resolved",
        category: "Incidents",
        payloadSchema: incidentResolvedPayload,
      },
      pluginMetadata
    );

    // ... rest of plugin init
  },
});
```

## Event Definition Properties

```typescript
interface IntegrationEventDefinition<T> {
  /** The hook to expose (must be created with createHook()) */
  hook: HookReference<T>;

  /** Human-readable name shown in UI */
  displayName: string;

  /** Description of when this event fires */
  description?: string;

  /** Category for UI grouping */
  category?: string;  // "Incidents", "Maintenance", "Health Checks", etc.

  /** Zod schema for payload (used for validation and JSON Schema) */
  payloadSchema: z.ZodType<T>;

  /** Optional: Transform payload before sending to webhooks */
  transformPayload?: (payload: T) => Record<string, unknown>;
}
```

## Payload Transformation

Sometimes you want to modify the payload before it's sent to external systems. Use `transformPayload` to:

- Add computed fields
- Rename fields for external compatibility  
- Redact sensitive information
- Flatten nested structures

```typescript
integrationEvents.registerEvent(
  {
    hook: incidentHooks.incidentCreated,
    displayName: "Incident Created",
    category: "Incidents",
    payloadSchema: incidentCreatedPayload,
    
    // Transform internal format to external-friendly format
    transformPayload: (payload) => ({
      id: payload.incidentId,
      type: "INCIDENT_CREATED",
      severity: payload.severity.toUpperCase(),
      affected_systems: payload.systemIds.length,
      system_ids: payload.systemIds,
      title: payload.title,
      timestamp: new Date().toISOString(),
    }),
  },
  pluginMetadata
);
```

## Event ID Namespacing

Events are automatically namespaced by plugin ID:

| Plugin ID | Hook ID | Full Event ID |
|-----------|---------|---------------|
| `incident` | `incident.created` | `incident.incident.created` |
| `maintenance` | `started` | `maintenance.started` |
| `healthcheck-http` | `state.changed` | `healthcheck-http.state.changed` |

## How Hook Subscribers Work

The integration backend subscribes to registered hooks using **work-queue mode**:

```typescript
// Inside integration-backend (automatic)
onHook(
  registeredEvent.hook,
  async (payload) => {
    // Route to all matching subscriptions
    await deliveryCoordinator.handleEvent(registeredEvent, payload);
  },
  { mode: "work-queue", workerGroup: `integration.${eventId}` }
);
```

**Work-queue mode** ensures:
- Only ONE instance processes each event (prevents duplicate deliveries)
- Events are distributed across cluster nodes for load balancing
- Failed processing can be retried

## Adding Integration Dependency

Add the integration packages to your plugin's `package.json`:

```json
{
  "dependencies": {
    "@checkstack/integration-backend": "workspace:*",
    "@checkstack/integration-common": "workspace:*"
  }
}
```

## Categories

Categories group events in the UI. Use consistent naming:

| Category | Description |
|----------|-------------|
| `Incidents` | Unplanned outages and issues |
| `Maintenance` | Scheduled maintenance windows |
| `Health` | Health check state changes |
| `Catalog` | System and group changes |
| `Auth` | User and authentication events |

## Example: Complete Plugin Integration

```typescript
// incident-backend/src/index.ts
import * as schema from "./schema";
import { z } from "zod";
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { integrationEventExtensionPoint } from "@checkstack/integration-backend";
import { pluginMetadata, incidentContract } from "@checkstack/incident-common";
import { incidentHooks } from "./hooks";
import { createRouter } from "./router";

// Payload schemas for integration events
const incidentCreatedPayload = z.object({
  incidentId: z.string(),
  systemIds: z.array(z.string()),
  title: z.string(),
  severity: z.string(),
});

const incidentUpdatedPayload = z.object({
  incidentId: z.string(),
  systemIds: z.array(z.string()),
  statusChange: z.string().optional(),
});

const incidentResolvedPayload = z.object({
  incidentId: z.string(),
  systemIds: z.array(z.string()),
});

export default createBackendPlugin({
  metadata: pluginMetadata,
  
  register(env) {
    // Register integration events in the register phase
    const integrationEvents = env.getExtensionPoint(
      integrationEventExtensionPoint
    );

    integrationEvents.registerEvent({
      hook: incidentHooks.incidentCreated,
      displayName: "Incident Created",
      description: "Fires when a new incident is created",
      category: "Incidents",
      payloadSchema: incidentCreatedPayload,
    }, pluginMetadata);

    integrationEvents.registerEvent({
      hook: incidentHooks.incidentUpdated,
      displayName: "Incident Updated",
      description: "Fires when an incident is updated",
      category: "Incidents",
      payloadSchema: incidentUpdatedPayload,
    }, pluginMetadata);

    integrationEvents.registerEvent({
      hook: incidentHooks.incidentResolved,
      displayName: "Incident Resolved",
      description: "Fires when an incident is resolved",
      category: "Incidents",
      payloadSchema: incidentResolvedPayload,
    }, pluginMetadata);

    // Continue with normal plugin initialization
    env.registerInit({
      schema,
      deps: { logger: coreServices.logger, rpc: coreServices.rpc },
      init: async ({ logger, database, rpc }) => {
        // ... router setup
      },
    });
  },
});
```

## Troubleshooting

### Event Not Appearing in UI

1. Check plugin is loaded (appears in Admin > Plugins)
2. Verify `integrationEventExtensionPoint` import path
3. Check browser console for registration errors

### Duplicate Deliveries

1. Ensure hooks use work-queue mode (handled automatically)
2. Check for duplicate `emitHook()` calls in your code

### Payload Schema Mismatch

1. Ensure Zod schema matches hook generic type
2. Check that `emitHook()` payload matches schema
