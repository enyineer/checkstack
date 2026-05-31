---
title: "Integration System"
description: "The Integration System enables external webhook delivery for platform events. Domain plugins expose their hooks as integration events, and provider plugins handle delivery to external systems (webh…"
---

The Integration System enables external webhook delivery for platform events. Domain plugins expose their hooks as integration events, and provider plugins handle delivery to external systems (webhooks, Slack, Jira, etc.).

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Platform Hooks                              │
│  (incident-backend, maintenance-backend, healthcheck-backend, etc.)  │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Integration Event Registry                        │
│              (Registers hooks as external-facing events)              │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Hook Subscriber                                │
│           (Subscribes to hooks in work-queue mode)                    │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Delivery Coordinator                             │
│        (Routes events through queue, manages retries)                 │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Integration Providers                            │
│         (Webhook, Slack, Jira, custom implementations)                │
└──────────────────────────────────────────────────────────────────────┘
```

## Key Concepts

### Integration Events

An **integration event** is a platform hook exposed for external webhook subscriptions. Domain plugins register their hooks as events via the extension point.

### Integration Providers  

A **provider** defines how to deliver events to specific external systems. Providers handle the actual HTTP calls, authentication, and error handling.

### Subscriptions

A **subscription** connects an event to a provider. When an event fires, all matching subscriptions trigger delivery attempts.

### Delivery Logs

Each delivery attempt is logged with status (success/failed/retrying), response details, and retry information.

## Flow: Hook Emission to External Delivery

1. **Hook Emission**: Domain plugin emits a hook (e.g., `incident.created`)
2. **Event Registry Lookup**: Integration system finds registered events for that hook
3. **Subscription Matching**: Queries subscriptions that listen for this event
4. **Queue Enqueue**: Creates delivery jobs in the distributed queue
5. **Worker Processing**: Queue workers pick up jobs and call providers
6. **Provider Delivery**: Provider makes HTTP request to external endpoint
7. **Logging**: Result logged to `delivery_logs` table
8. **Retry (if needed)**: Failed deliveries re-queued with exponential backoff

## Packages

| Package | Purpose |
|---------|---------|
| `integration-common` | Shared types, schemas, RPC contract |
| `integration-backend` | Core registries, delivery coordinator, router |
| `integration-frontend` | Admin UI for managing subscriptions |
| `integration-webhook-backend` | Generic HTTP webhook provider |

## Quick Start

### Exposing a Hook as an Integration Event

```typescript
// In your plugin's index.ts
import { integrationEventExtensionPoint } from "@checkstack/integration-backend";
import { myPluginHooks } from "./hooks";
import { z } from "zod";

// Define payload schema for the event
const incidentCreatedPayload = z.object({
  incidentId: z.string(),
  title: z.string(),
  severity: z.string(),
  systemIds: z.array(z.string()),
});

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    // Get the integration extension point
    const integrationEvents = env.getExtensionPoint(
      integrationEventExtensionPoint
    );

    // Register hook as an integration event
    integrationEvents.registerEvent(
      {
        hook: myPluginHooks.incidentCreated,
        displayName: "Incident Created",
        description: "Fires when a new incident is created",
        category: "Incidents",
        payloadSchema: incidentCreatedPayload,
      },
      pluginMetadata
    );
  },
});
```

### Creating a Custom Provider

See [Provider Implementation Guide](/checkstack/developer-guide/backend/integrations/providers/).

## Related Documentation

- [Provider Implementation Guide](/checkstack/developer-guide/backend/integrations/providers/)
- [Hooks and Events](/checkstack/developer-guide/backend/signals/)
- [Queue System](/checkstack/developer-guide/backend/queue-system/)
