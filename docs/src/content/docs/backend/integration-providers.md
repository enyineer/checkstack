---
title: "Integration Providers"
description: "This guide explains how to create custom integration providers that deliver platform events to external systems."
---
# Integration Providers

This guide explains how to create custom integration providers that deliver platform events to external systems.

## Overview

An **integration provider** is a plugin that handles event delivery to a specific external system. Examples include:

- **Webhook**: Generic HTTP POST to any endpoint
- **Slack**: Posts messages to Slack channels
- **Jira**: Creates or updates Jira issues
- **PagerDuty**: Triggers alerts in PagerDuty

## Provider Interface

```typescript
interface IntegrationProvider<TConfig, TConnection = undefined> {
  /** Local identifier, namespaced on registration */
  id: string;
  
  /** Display name for UI */
  displayName: string;
  
  /** Description of what this provider does */
  description?: string;
  
  /** Lucide icon name for UI */
  icon?: string;
  
  /** Per-subscription configuration schema */
  config: Versioned<TConfig>;
  
  /** Optional site-wide connection schema (for shared credentials) */
  connectionSchema?: Versioned<TConnection>;
  
  /** Events this provider can handle (undefined = all) */
  supportedEvents?: string[];
  
  /** Optional documentation for users */
  documentation?: ProviderDocumentation;
  
  /** Deliver an event to the external system */
  deliver(context: IntegrationDeliveryContext<TConfig>): Promise<IntegrationDeliveryResult>;
  
  /** Optional: Test the provider configuration */
  testConnection?(config: TConfig): Promise<TestConnectionResult>;
  
  /** Optional: Fetch dynamic options for cascading dropdowns */
  getConnectionOptions?(params: GetConnectionOptionsParams): Promise<ConnectionOption[]>;
}
```

## Creating a Provider Plugin

### 1. Create the Plugin Package

```bash
mkdir -p plugins/integration-myservice-backend/src
```

**package.json**:
```json
{
  "name": "@checkstack/integration-myservice-backend",
  "version": "0.0.1",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "@checkstack/backend-api": "workspace:*",
    "@checkstack/integration-backend": "workspace:*",
    "@checkstack/integration-common": "workspace:*",
    "@checkstack/common": "workspace:*",
    "zod": "^4.2.1"
  }
}
```

### 2. Define the Configuration Schema

Use Zod to define the provider's configuration. Use `configString({ "x-secret": true })` for sensitive fields:

```typescript
// src/provider.ts
import { z } from "zod";
import { Versioned, configString, configNumber } from "@checkstack/backend-api";

export const myServiceConfigSchemaV1 = z.object({
  // Required fields
  apiEndpoint: configString({}).url().describe("Service API endpoint"),
  
  // Secret fields (encrypted at rest)
  apiKey: configString({ "x-secret": true }).describe("API Key for authentication"),
  
  // Optional fields with defaults
  timeout: configNumber({})
    .min(1_000)
    .max(60_000)
    .default(10_000)
    .describe("Request timeout in milliseconds"),
  
  // Enum fields
  priority: z.enum(["low", "medium", "high"])
    .default("medium")
    .describe("Alert priority level"),
});

export type MyServiceConfig = z.infer<typeof myServiceConfigSchemaV1>;
```

### 3. Implement the Provider

```typescript
// src/provider.ts (continued)
import type {
  IntegrationProvider,
  IntegrationDeliveryContext,
  IntegrationDeliveryResult,
  TestConnectionResult,
} from "@checkstack/integration-backend";

export const myServiceProvider: IntegrationProvider<MyServiceConfig> = {
  id: "myservice",
  displayName: "My Service",
  description: "Deliver events to My Service",
  icon: "Bell", // Lucide icon name

  config: new Versioned({
    version: 1,
    schema: myServiceConfigSchemaV1,
  }),

  // Optional: Limit which events this provider accepts
  // supportedEvents: ["incident.created", "incident.resolved"],

  async deliver(
    context: IntegrationDeliveryContext<MyServiceConfig>
  ): Promise<IntegrationDeliveryResult> {
    const { event, subscription, providerConfig, logger } = context;

    try {
      logger.debug(`Delivering to My Service: ${event.eventId}`);

      // Make the API call
      const response = await fetch(providerConfig.apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${providerConfig.apiKey}`,
        },
        body: JSON.stringify({
          event_type: event.eventId,
          timestamp: event.timestamp,
          delivery_id: event.deliveryId,
          subscription_name: subscription.name,
          data: event.payload,
        }),
        signal: AbortSignal.timeout(providerConfig.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
          // Optionally request retry after delay
          retryAfterMs: response.status === 429 ? 60_000 : undefined,
        };
      }

      // Parse response to get external ID if available
      const json = await response.json();
      
      return {
        success: true,
        externalId: json.id, // ID from external system
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Delivery failed: ${message}`);

      // Network errors should trigger retry
      if (message.includes("timeout") || message.includes("ECONNREFUSED")) {
        return {
          success: false,
          error: message,
          retryAfterMs: 30_000,
        };
      }

      return {
        success: false,
        error: message,
      };
    }
  },

  // Optional: Test connection functionality
  async testConnection(config: MyServiceConfig): Promise<TestConnectionResult> {
    try {
      const response = await fetch(`${config.apiEndpoint}/health`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${config.apiKey}`,
        },
        signal: AbortSignal.timeout(5_000),
      });

      if (response.ok) {
        return { success: true, message: "Connection successful" };
      }

      return {
        success: false,
        message: `Server returned ${response.status}`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Connection failed",
      };
    }
  },
};
```

### 4. Register the Provider

```typescript
// src/index.ts
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { integrationProviderExtensionPoint } from "@checkstack/integration-backend";
import { definePluginMetadata } from "@checkstack/common";
import { myServiceProvider } from "./provider";

const pluginMetadata = definePluginMetadata({
  pluginId: "integration-myservice",
});

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
      },
      init: async ({ logger }) => {
        logger.debug("Registering My Service Integration Provider...");

        // Get the integration provider extension point
        const extensionPoint = env.getExtensionPoint(
          integrationProviderExtensionPoint
        );

        // Register the provider
        extensionPoint.addProvider(myServiceProvider, pluginMetadata);

        logger.debug("My Service Integration Provider registered.");
      },
    });
  },
});
```

## Delivery Context

The `deliver()` method receives a context object with:

```typescript
interface IntegrationDeliveryContext<TConfig> {
  event: {
    eventId: string;      // Fully qualified: "incident.incident.created"
    payload: Record<string, unknown>;  // Event data
    timestamp: string;    // ISO timestamp
    deliveryId: string;   // Unique delivery attempt ID
  };
  subscription: {
    id: string;           // Subscription ID
    name: string;         // User-defined name
  };
  providerConfig: TConfig;  // Configuration for this subscription
  logger: IntegrationLogger;  // Scoped logger for tracing
}
```

## Delivery Result

Return a result indicating success or failure:

```typescript
interface IntegrationDeliveryResult {
  success: boolean;
  
  /** External ID from target system (e.g., Jira issue key) */
  externalId?: string;
  
  /** Error message if failed */
  error?: string;
  
  /** Request retry after this delay (triggers re-queue) */
  retryAfterMs?: number;
}
```

## Retry Behavior

- Return `retryAfterMs` to request a retry after the specified delay
- The delivery coordinator uses exponential backoff: 1min, 5min, 15min
- Maximum 3 retry attempts before marking as permanently failed
- Network errors (timeout, connection refused) automatically trigger retry

## Best Practices

1. **Use `configString({ "x-secret": true })` for sensitive config**: API keys, tokens, passwords
2. **Set reasonable timeouts**: Default 10 seconds, allow user configuration
3. **Parse error responses**: Include meaningful error messages for debugging
4. **Implement `testConnection`**: Helps users validate their configuration
5. **Log at appropriate levels**: Use `debug` for success, `error` for failures
6. **Handle rate limiting**: Check for 429 responses and respect Retry-After headers
7. **Return external IDs**: Helps users correlate platform events with external records

## Example: Slack Provider

```typescript
export const slackProvider: IntegrationProvider<SlackConfig> = {
  id: "slack",
  displayName: "Slack",
  description: "Post messages to Slack channels",
  icon: "MessageSquare",

  config: new Versioned({
    version: 1,
    schema: z.object({
      webhookUrl: configString({ "x-secret": true }).describe("Slack Incoming Webhook URL"),
      channel: configString({}).optional().describe("Override channel (optional)"),
      username: configString({}).default("Checkstack").describe("Bot username"),
      iconEmoji: configString({}).default(":robot_face:").describe("Bot icon emoji"),
    }),
  }),

  async deliver(context) {
    const { event, providerConfig } = context;
    
    const response = await fetch(providerConfig.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: providerConfig.channel,
        username: providerConfig.username,
        icon_emoji: providerConfig.iconEmoji,
        text: `*${event.eventId}*\n${JSON.stringify(event.payload, null, 2)}`,
      }),
    });

    if (!response.ok) {
      return { success: false, error: await response.text() };
    }

    return { success: true };
  },
};
```

## Testing Providers

Use Bun's test framework with mocked fetch:

```typescript
import { describe, it, expect, spyOn } from "bun:test";
import { myServiceProvider } from "./provider";

describe("MyServiceProvider", () => {
  it("delivers events successfully", async () => {
    const mockFetch = spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ id: "ext-123" }), { status: 200 })
    );

    try {
      const result = await myServiceProvider.deliver({
        event: {
          eventId: "test.event",
          payload: { key: "value" },
          timestamp: new Date().toISOString(),
          deliveryId: "del-1",
        },
        subscription: { id: "sub-1", name: "Test" },
        providerConfig: {
          apiEndpoint: "https://api.example.com",
          apiKey: "secret",
          timeout: 10_000,
          priority: "medium",
        },
        logger: { debug: () => {}, error: () => {} },
      });

      expect(result.success).toBe(true);
      expect(result.externalId).toBe("ext-123");
    } finally {
      mockFetch.mockRestore();
    }
  });
});
```

## Connection-Based Providers with Dynamic Options

Some integrations (like Jira, Slack, GitHub) require pre-configured connections with credentials, and configuration fields that need to dynamically fetch options from the external API.

### Connection Schema

Define a connection schema for storing API credentials:

```typescript
import { z } from "zod";
import { configString } from "@checkstack/backend-api";

export const MyServiceConnectionConfigSchema = z.object({
  baseUrl: configString({}).url().describe("Service API URL"),
  email: configString({}).email().describe("User email"),
  apiToken: configString({ "x-secret": true }).describe("API token"),
});

export type MyServiceConnectionConfig = z.infer<typeof MyServiceConnectionConfigSchema>;
```

### Provider Config with Dynamic Options

Use `configString()` with metadata for fields that need to fetch options from the external API:

```typescript
// Define resolver names as constants
export const RESOLVERS = {
  PROJECT_OPTIONS: "projectOptions",
  ISSUE_TYPE_OPTIONS: "issueTypeOptions",
  FIELD_OPTIONS: "fieldOptions",
} as const;

export const MyServiceProviderConfigSchema = z.object({
  // Hidden field for connection reference
  connectionId: configString({ "x-hidden": true }).describe("Connection ID"),
  
  // Static options from backend
  projectKey: configString({
    "x-options-resolver": RESOLVERS.PROJECT_OPTIONS,
  }).describe("Project"),
  
  // Dependent options (refetch when projectKey changes)
  issueTypeId: configString({
    "x-options-resolver": RESOLVERS.ISSUE_TYPE_OPTIONS,
    "x-depends-on": ["projectKey"],
  }).describe("Issue type"),
  
  // Searchable dropdown for many options
  fieldKey: configString({
    "x-options-resolver": RESOLVERS.FIELD_OPTIONS,
    "x-depends-on": ["projectKey", "issueTypeId"],
    "x-searchable": true,
  }).describe("Field"),
});
```

### Implementing getConnectionOptions

The provider must implement `getConnectionOptions()` to handle option resolver calls:

```typescript
import type {
  IntegrationProvider,
  ConnectionOption,
  GetConnectionOptionsParams,
} from "@checkstack/integration-backend";

export const myServiceProvider: IntegrationProvider<MyServiceConfig> = {
  id: "myservice",
  displayName: "My Service",
  
  // Connection schema for storing credentials
  connectionSchema: new Versioned({
    version: 1,
    schema: MyServiceConnectionConfigSchema,
  }),
  
  // Provider config uses dynamic options
  config: new Versioned({
    version: 1,
    schema: MyServiceProviderConfigSchema,
  }),

  /**
   * Fetch dynamic options for resolver fields.
   * Called by the frontend when a field with optionsResolver needs options.
   */
  async getConnectionOptions(
    params: GetConnectionOptionsParams
  ): Promise<ConnectionOption[]> {
    const {
      connectionId,
      resolverName,
      context, // Current form values
      getConnectionWithCredentials,
      logger,
    } = params;

    // Get the connection with credentials
    const connection = await getConnectionWithCredentials(connectionId);
    if (!connection) {
      return [];
    }

    const config = connection.config as MyServiceConnectionConfig;
    const client = createApiClient(config, logger);

    try {
      switch (resolverName) {
        case RESOLVERS.PROJECT_OPTIONS: {
          const projects = await client.getProjects();
          return projects.map((p) => ({
            value: p.key,
            label: `${p.name} (${p.key})`,
          }));
        }

        case RESOLVERS.ISSUE_TYPE_OPTIONS: {
          // Access dependent field from context
          const projectKey = context?.projectKey as string | undefined;
          if (!projectKey) {
            return [];
          }
          const issueTypes = await client.getIssueTypes(projectKey);
          return issueTypes.map((t) => ({
            value: t.id,
            label: t.name,
          }));
        }

        case RESOLVERS.FIELD_OPTIONS: {
          const projectKey = context?.projectKey as string | undefined;
          const issueTypeId = context?.issueTypeId as string | undefined;
          if (!projectKey || !issueTypeId) {
            return [];
          }
          const fields = await client.getFields(projectKey, issueTypeId);
          return fields.map((f) => ({
            value: f.key,
            label: `${f.name}${f.required ? " *" : ""}`,
          }));
        }

        default:
          logger.error(`Unknown resolver: ${resolverName}`);
          return [];
      }
    } catch (error) {
      logger.error("Failed to get options", error);
      return [];
    }
  },

  // ... deliver() implementation
};
```

### How Dynamic Options Flow Works

1. **Frontend renders form** with `optionsResolver` fields
2. **DynamicForm detects** `x-options-resolver` metadata in JSON Schema
3. **Frontend calls** `getConnectionOptions` RPC with resolver name and current form values
4. **Backend routes** the call to the provider's `getConnectionOptions` method
5. **Provider fetches** options from external API using connection credentials
6. **Options returned** to frontend and rendered in dropdown

### Dependency Tracking

The `dependsOn` option enables smart refetching:

```typescript
issueTypeId: configString({
  "x-options-resolver": "issueTypeOptions",
  "x-depends-on": ["projectKey"], // Only refetch when projectKey changes
})
```

- Options are **only refetched** when a dependent field value changes
- Other form changes do **not** trigger unnecessary API calls
- This is implemented using React refs to avoid adding formValues to useEffect dependencies

### Searchable Dropdowns

For fields with many options, enable searchable:

```typescript
fieldKey: configString({
  "x-options-resolver": "fieldOptions",
  "x-searchable": true, // Enables search inside dropdown
})
```

This renders a dropdown with a search input inside the dropdown panel, allowing users to filter options by typing.

### Reference Implementation

See the Jira integration provider for a complete example:
- [`integration-jira-backend/src/provider.ts`](/plugins/integration-jira-backend/src/provider.ts) - Full provider with `getConnectionOptions`
- [`integration-jira-backend/src/jira-client.ts`](/plugins/integration-jira-backend/src/jira-client.ts) - API client for fetching options

