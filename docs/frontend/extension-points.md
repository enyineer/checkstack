---
---
# Extension Points and Strategies

## Overview

Extension points enable plugins to provide **pluggable implementations** for core functionality. They follow the **Strategy Pattern**, allowing different implementations to be swapped at runtime.

## Core Concepts

### Extension Point

A **contract** that defines what implementations must provide:

```typescript
interface ExtensionPoint<T> {
  id: string;
  T: T; // Phantom type for type safety
}
```

### Strategy

An **implementation** of an extension point:

```typescript
interface Strategy {
  id: string;
  displayName: string;
  // ... strategy-specific methods
}
```

## Backend Extension Points

### HealthCheckStrategy

Implements custom health check methods.

#### Interface

```typescript
interface HealthCheckStrategy<Config = unknown> {
  /** Unique identifier for this strategy */
  id: string;

  /** Human-readable name */
  displayName: string;

  /** Optional description */
  description?: string;

  /** Current version of the configuration schema */
  configVersion: number;

  /** Validation schema for the strategy-specific config */
  configSchema: z.ZodType<Config>;

  /** Optional migrations for backward compatibility */
  migrations?: MigrationChain<Config>;

  /** Execute the health check */
  execute(config: Config): Promise<HealthCheckResult>;
}

interface HealthCheckResult {
  status: "healthy" | "unhealthy" | "degraded";
  latency?: number; // ms
  message?: string;
  metadata?: Record<string, unknown>;
}
```

#### Example: HTTP Health Check

```typescript
import { z } from "zod";
import { HealthCheckStrategy } from "@checkmate-monitor/backend-api";

const httpCheckConfig = z.object({
  url: z.string().url().describe("URL to check"),
  method: z.enum(["GET", "POST", "HEAD"]).default("GET"),
  timeout: z.number().min(100).max(30000).default(5000),
  expectedStatus: z.number().min(100).max(599).default(200),
  headers: z.record(z.string()).optional(),
});

type HttpCheckConfig = z.infer<typeof httpCheckConfig>;

export const httpHealthCheckStrategy: HealthCheckStrategy<HttpCheckConfig> = {
  id: "http-check",
  displayName: "HTTP Health Check",
  description: "Check if an HTTP endpoint is responding",
  configVersion: 1,
  configSchema: httpCheckConfig,

  async execute(config: HttpCheckConfig): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(config.url, {
        method: config.method,
        headers: config.headers,
        signal: AbortSignal.timeout(config.timeout),
      });

      const latency = Date.now() - startTime;

      if (response.status === config.expectedStatus) {
        return {
          status: "healthy",
          latency,
          message: `HTTP ${response.status}`,
        };
      } else {
        return {
          status: "unhealthy",
          latency,
          message: `Expected ${config.expectedStatus}, got ${response.status}`,
        };
      }
    } catch (error) {
      return {
        status: "unhealthy",
        latency: Date.now() - startTime,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
};
```

#### Registering a Health Check Strategy

```typescript
import { healthCheckExtensionPoint } from "@checkmate-monitor/backend-api";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    // Get the health check registry
    const registry = env.getExtensionPoint(healthCheckExtensionPoint);

    // Register the strategy
    registry.register(httpHealthCheckStrategy);
  },
});
```

### ExporterStrategy

Exports metrics and data in various formats.

#### Interface

```typescript
interface ExporterStrategy<Config = unknown> {
  id: string;
  displayName: string;
  description?: string;
  configVersion: number;
  configSchema: z.ZodType<Config>;
  migrations?: MigrationChain<Config>;

  /** Export type: endpoint or file */
  type: "endpoint" | "file";

  /** For endpoint exporters: register routes */
  registerRoutes?(router: Hono, config: Config): void;

  /** For file exporters: generate file */
  generateFile?(config: Config): Promise<{
    filename: string;
    content: string | Buffer;
    mimeType: string;
  }>;
}
```

#### Example: Prometheus Exporter

```typescript
const prometheusConfig = z.object({
  path: z.string().default("/metrics"),
  includeTimestamps: z.boolean().default(false),
});

type PrometheusConfig = z.infer<typeof prometheusConfig>;

export const prometheusExporter: ExporterStrategy<PrometheusConfig> = {
  id: "prometheus",
  displayName: "Prometheus Metrics",
  description: "Export metrics in Prometheus format",
  configVersion: 1,
  configSchema: prometheusConfig,
  type: "endpoint",

  registerRoutes(router, config) {
    router.get(config.path, async (c) => {
      const metrics = await collectMetrics();
      const output = formatPrometheus(metrics, config.includeTimestamps);
      return c.text(output, 200, {
        "Content-Type": "text/plain; version=0.0.4",
      });
    });
  },
};
```

#### Example: CSV Exporter

```typescript
const csvConfig = z.object({
  includeHeaders: z.boolean().default(true),
  delimiter: z.string().default(","),
});

type CsvConfig = z.infer<typeof csvConfig>;

export const csvExporter: ExporterStrategy<CsvConfig> = {
  id: "csv",
  displayName: "CSV Export",
  description: "Export data as CSV file",
  configVersion: 1,
  configSchema: csvConfig,
  type: "file",

  async generateFile(config) {
    const data = await fetchData();
    const csv = formatCsv(data, config);

    return {
      filename: `export-${Date.now()}.csv`,
      content: csv,
      mimeType: "text/csv",
    };
  },
};
```

### NotificationStrategy

Send notifications via different channels.

#### Interface

```typescript
interface NotificationStrategy<Config = unknown> {
  id: string;
  displayName: string;
  description?: string;
  configVersion: number;
  configSchema: z.ZodType<Config>;
  migrations?: MigrationChain<Config>;

  /** Send a notification */
  send(config: Config, notification: Notification): Promise<void>;
}

interface Notification {
  title: string;
  message: string;
  severity: "info" | "warning" | "error" | "critical";
  metadata?: Record<string, unknown>;
}
```

#### Example: Slack Notification

```typescript
const slackConfig = z.object({
  webhookUrl: z.string().url(),
  channel: z.string().optional(),
  username: z.string().default("Checkmate"),
  iconEmoji: z.string().default(":robot_face:"),
});

type SlackConfig = z.infer<typeof slackConfig>;

export const slackNotificationStrategy: NotificationStrategy<SlackConfig> = {
  id: "slack",
  displayName: "Slack",
  description: "Send notifications to Slack",
  configVersion: 1,
  configSchema: slackConfig,

  async send(config, notification) {
    const color = {
      info: "#36a64f",
      warning: "#ff9900",
      error: "#ff0000",
      critical: "#990000",
    }[notification.severity];

    await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: config.channel,
        username: config.username,
        icon_emoji: config.iconEmoji,
        attachments: [
          {
            color,
            title: notification.title,
            text: notification.message,
            fields: Object.entries(notification.metadata || {}).map(
              ([key, value]) => ({
                title: key,
                value: String(value),
                short: true,
              })
            ),
          },
        ],
      }),
    });
  },
};
```

#### Example: Email Notification

```typescript
const emailConfig = z.object({
  smtpHost: z.string(),
  smtpPort: z.number().default(587),
  username: z.string(),
  password: z.string(),
  from: z.string().email(),
  to: z.array(z.string().email()),
});

type EmailConfig = z.infer<typeof emailConfig>;

export const emailNotificationStrategy: NotificationStrategy<EmailConfig> = {
  id: "email",
  displayName: "Email",
  description: "Send notifications via email",
  configVersion: 1,
  configSchema: emailConfig,

  async send(config, notification) {
    const transporter = createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      auth: {
        user: config.username,
        pass: config.password,
      },
    });

    await transporter.sendMail({
      from: config.from,
      to: config.to.join(", "),
      subject: notification.title,
      text: notification.message,
      html: formatEmailHtml(notification),
    });
  },
};
```

### AuthenticationStrategy

Integrate authentication providers using Better Auth.

#### Interface

```typescript
interface AuthenticationStrategy<Config = unknown> {
  id: string;
  displayName: string;
  description?: string;
  configVersion: number;
  configSchema: z.ZodType<Config>;
  migrations?: MigrationChain<Config>;

  /** Configure Better Auth with this strategy */
  configure(config: Config): BetterAuthConfig;
}
```

#### Example: OAuth Provider

```typescript
const oauthConfig = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  authorizationUrl: z.string().url(),
  tokenUrl: z.string().url(),
  userInfoUrl: z.string().url(),
});

type OAuthConfig = z.infer<typeof oauthConfig>;

export const oauthStrategy: AuthenticationStrategy<OAuthConfig> = {
  id: "oauth",
  displayName: "OAuth 2.0",
  description: "Authenticate using OAuth 2.0",
  configVersion: 1,
  configSchema: oauthConfig,

  configure(config) {
    return {
      socialProviders: {
        custom: {
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          authorizationUrl: config.authorizationUrl,
          tokenUrl: config.tokenUrl,
          userInfoUrl: config.userInfoUrl,
        },
      },
    };
  },
};
```

> [!WARNING] Registration Check Requirement
>
> If your custom authentication strategy creates new user accounts automatically (e.g., LDAP, SSO, or custom OAuth implementations), you **must** check the platform's registration settings before creating users.
>
> Use the typed RPC client to call `auth-backend.getRegistrationStatus()` and verify that `allowRegistration` is `true` before creating any new users. If registration is disabled, throw an appropriate error.
>
> **Example:**
> ```typescript
> import { coreServices } from "@checkmate-monitor/backend-api";
> import { AuthApi } from "@checkmate-monitor/auth-common";
>
> env.registerInit({
>   deps: {
>     rpcClient: coreServices.rpcClient,
>     logger: coreServices.logger,
>   },
>   init: async ({ rpcClient, logger }) => {
>     // In your user sync/creation logic:
>     try {
>       const authClient = rpcClient.forPlugin(AuthApi);
>       const { allowRegistration } = await authClient.getRegistrationStatus();
>       
>       if (!allowRegistration) {
>         throw new Error(
>           "Registration is disabled. Please contact an administrator."
>         );
>       }
>       
>       // Proceed with user creation
>     } catch (error) {
>       logger.warn("Failed to check registration status:", error);
>       throw error;
>     }
>   },
> });
> ```
>
> This ensures administrators have full control over user registration across all authentication methods. See [Backend Service Communication](../backend/services.md) for more details on using the RPC client.

## Frontend Extension Points

### Slots

Slots allow plugins to inject UI components into predefined locations. Plugins can either:
1. Register extensions to **core slots** defined in `@checkmate-monitor/frontend-api`
2. Register extensions to **plugin-defined slots** exported from plugin common packages

#### Core Slots (from `@checkmate-monitor/frontend-api`)

Core slots are defined using the `createSlot` utility and exported as `SlotDefinition` objects:

```typescript
import {
  DashboardSlot,
  NavbarRightSlot,
  NavbarLeftSlot,
  UserMenuItemsSlot,
  UserMenuItemsBottomSlot,
} from "@checkmate-monitor/frontend-api";
```

#### Plugin-Defined Slots

Plugins can expose their own slots using the `createSlot` utility from `@checkmate-monitor/frontend-api`. This allows other plugins to extend specific areas of your plugin's UI.

**Example: Catalog plugin exposing slots (from `@checkmate-monitor/catalog-common`)**

```typescript
import { createSlot } from "@checkmate-monitor/frontend-api";
import type { System } from "./types";

// Slot for extending the System Details page
export const SystemDetailsSlot = createSlot<{ system: System }>(
  "plugin.catalog.system-details"
);

// Slot for adding actions to the system configuration page
export const CatalogSystemActionsSlot = createSlot<{
  systemId: string;
  systemName: string;
}>("plugin.catalog.system-actions");
```

#### Registering Extensions to Slots

Extensions use the `slot:` property with a `SlotDefinition` object:

**To a core slot:**
```typescript
import { UserMenuItemsSlot } from "@checkmate-monitor/frontend-api";

export const myPlugin = createFrontendPlugin({
  name: "myplugin-frontend",
  extensions: [
    {
      id: "myplugin.user-menu.items",
      slot: UserMenuItemsSlot,
      component: MyUserMenuItems,
    },
  ],
});
```

**To a plugin-defined slot:**
```typescript
import { SystemDetailsSlot } from "@checkmate-monitor/catalog-common";

export const myPlugin = createFrontendPlugin({
  name: "myplugin-frontend",
  extensions: [
    {
      id: "myplugin.system-details",
      slot: SystemDetailsSlot,
      component: MySystemDetailsExtension, // Receives { system: System }
    },
  ],
});
```

#### Type-Safe Extension Registration (Recommended)

For strict typing that infers component props directly from the slot definition, use the `createSlotExtension` helper and `SlotContext` type.

**Using `createSlotExtension` for registration:**
```typescript
import { createFrontendPlugin, createSlotExtension } from "@checkmate-monitor/frontend-api";
import { SystemDetailsSlot, CatalogSystemActionsSlot } from "@checkmate-monitor/catalog-common";

export default createFrontendPlugin({
  name: "myplugin-frontend",
  extensions: [
    // Type-safe: component props are inferred from SystemDetailsSlot
    createSlotExtension(SystemDetailsSlot, {
      id: "myplugin.system-details",
      component: MySystemDetailsPanel, // Must accept { system: System }
    }),
    createSlotExtension(CatalogSystemActionsSlot, {
      id: "myplugin.system-actions",
      component: MySystemAction, // Must accept { systemId: string; systemName: string }
    }),
  ],
});
```

**Using `SlotContext` for component typing:**
```typescript
import type { SlotContext } from "@checkmate-monitor/frontend-api";
import { CatalogSystemActionsSlot } from "@checkmate-monitor/catalog-common";

// Props inferred directly from the slot definition - no manual interface needed!
type Props = SlotContext<typeof CatalogSystemActionsSlot>;
// Equivalent to: { systemId: string; systemName: string }

export const MySystemAction: React.FC<Props> = ({ systemId, systemName }) => {
  // Full type safety - no casting, no unknown!
  return <Button onClick={() => doSomething(systemId)}>Action for {systemName}</Button>;
};
```

> [!TIP]
> Using `SlotContext` and `createSlotExtension` ensures compile-time type checking. If the slot definition changes, TypeScript will immediately flag any component prop mismatches.

#### Example: User Menu Extension

User menu slots (`UserMenuItemsSlot`, `UserMenuItemsBottomSlot`) receive a `UserMenuItemsContext` with pre-fetched user data for synchronous rendering:

```typescript
interface UserMenuItemsContext {
  permissions: string[];      // Pre-fetched user permissions
  hasCredentialAccount: boolean;  // Whether user has credential auth
}
```

**Permission-gated menu item:**
```typescript
import type { UserMenuItemsContext } from "@checkmate-monitor/frontend-api";
import { qualifyPermissionId, resolveRoute } from "@checkmate-monitor/common";
import { permissions, pluginMetadata, myRoutes } from "@checkmate-monitor/myplugin-common";
import { DropdownMenuItem } from "@checkmate-monitor/ui";
import { Link } from "react-router-dom";
import { Settings } from "lucide-react";

export const MyPluginMenuItems = ({
  permissions: userPerms,
}: UserMenuItemsContext) => {
  const qualifiedId = qualifyPermissionId(pluginMetadata, permissions.myPermission);
  const canAccess = userPerms.includes("*") || userPerms.includes(qualifiedId);

  if (!canAccess) return null;

  return (
    <Link to={resolveRoute(myRoutes.routes.settings)}>
      <DropdownMenuItem icon={<Settings className="h-4 w-4" />}>
        My Settings
      </DropdownMenuItem>
    </Link>
  );
};
```

**Registration with `createSlotExtension`:**
```typescript
import { createSlotExtension, UserMenuItemsSlot } from "@checkmate-monitor/frontend-api";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "myplugin.user-menu.items",
      component: MyPluginMenuItems,
    }),
  ],
});
```

#### Example: Dashboard Widget

```typescript
export const MyDashboardWidget = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>My Widget</CardTitle>
      </CardHeader>
      <CardContent>
        <p>Widget content here</p>
      </CardContent>
    </Card>
  );
};
```

## Creating Custom Extension Points

### Backend Extension Point

```typescript
// 1. Define the interface
export interface CustomStrategy<Config = unknown> {
  id: string;
  displayName: string;
  configSchema: z.ZodType<Config>;
  execute(config: Config): Promise<Result>;
}

// 2. Create the extension point
import { createExtensionPoint } from "@checkmate-monitor/backend-api";

export const customExtensionPoint = createExtensionPoint<CustomStrategy[]>(
  "custom-extension"
);

// 3. Create a registry
export class CustomRegistry {
  private strategies = new Map<string, CustomStrategy>();

  register(strategy: CustomStrategy) {
    this.strategies.set(strategy.id, strategy);
  }

  getStrategy(id: string): CustomStrategy | undefined {
    return this.strategies.get(id);
  }

  getStrategies(): CustomStrategy[] {
    return Array.from(this.strategies.values());
  }
}

// 4. Register in core
const registry = new CustomRegistry();
env.registerExtensionPoint(customExtensionPoint, registry);

// 5. Plugins can now register implementations
const myStrategy: CustomStrategy = {
  id: "my-impl",
  displayName: "My Implementation",
  configSchema: z.object({ /* ... */ }),
  async execute(config) {
    // Implementation
  },
};

const registry = env.getExtensionPoint(customExtensionPoint);
registry.register(myStrategy);
```

### Frontend Extension Point (Slot)

To expose a slot from your plugin that other plugins can extend:

```typescript
// 1. Define the slot in your plugin's -common package
// e.g., in @checkmate-monitor/myplugin-common/src/slots.ts
import { createSlot } from "@checkmate-monitor/frontend-api";

// Define with typed context that extensions will receive
export const MyPluginCustomSlot = createSlot<{ itemId: string }>(
  "myplugin.custom.slot"
);

// 2. Export from your common package index
export * from "./slots";

// 3. Use the slot in your plugin's frontend component
import { ExtensionSlot } from "@checkmate-monitor/frontend-api";
import { MyPluginCustomSlot } from "@checkmate-monitor/myplugin-common";

export const MyComponent = ({ itemId }: { itemId: string }) => {
  return (
    <div>
      {/* Your plugin's content */}
      <h1>My Component</h1>
      
      {/* Extension point for other plugins */}
      <ExtensionSlot
        slot={MyPluginCustomSlot}
        context={{ itemId }}
      />
    </div>
  );
};

// 4. Other plugins can now register extensions
// e.g., in @checkmate-monitor/other-plugin-frontend
import { MyPluginCustomSlot } from "@checkmate-monitor/myplugin-common";

export default createFrontendPlugin({
  name: "other-plugin-frontend",
  extensions: [
    {
      id: "other-plugin.myplugin-extension",
      slot: MyPluginCustomSlot,
      component: ({ itemId }) => <MyExtension itemId={itemId} />,
    },
  ],
});
```

## Best Practices

### 1. Use Descriptive IDs

```typescript
// ✅ Good
id: "http-health-check"
id: "slack-notification"

// ❌ Bad
id: "check1"
id: "notif"
```

### 2. Provide Clear Descriptions

```typescript
displayName: "HTTP Health Check",
description: "Checks if an HTTP endpoint is responding with the expected status code"
```

### 3. Use Zod Descriptions

```typescript
const config = z.object({
  url: z.string().url().describe("The URL to check"),
  timeout: z.number().describe("Request timeout in milliseconds"),
});
```

These descriptions are used to generate UI forms automatically.

### 4. Handle Errors Gracefully

```typescript
async execute(config) {
  try {
    // Implementation
  } catch (error) {
    return {
      status: "unhealthy",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
```

### 5. Test Strategies

```typescript
import { describe, expect, test } from "bun:test";

describe("HTTP Health Check Strategy", () => {
  test("returns healthy for 200 response", async () => {
    const result = await httpHealthCheckStrategy.execute({
      url: "https://example.com",
      method: "GET",
      timeout: 5000,
      expectedStatus: 200,
    });

    expect(result.status).toBe("healthy");
  });
});
```

## Next Steps

- [Backend Plugin Development](../backend/plugins.md)
- [Frontend Plugin Development](./plugins.md)
- [Versioned Configurations](../backend/versioned-configs.md)
- [Contributing Guide](../getting-started/contributing.md)
