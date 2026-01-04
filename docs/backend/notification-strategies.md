---
layout: default
title: Notification Strategies
---

# Notification Strategies

The Notification Strategy system enables plugins to deliver notifications to users through external channels (email, Slack, Discord, SMS, etc.), extending beyond the platform's in-app notification system.

## Architecture Overview

```mermaid
graph TD
    subgraph "Strategy Plugins"
        SMTP["notification-smtp-backend"]
        Slack["notification-slack-backend"]
        SMS["notification-sms-backend"]
    end

    subgraph "Notification Backend"
        EP["Extension Point"]
        Registry["Strategy Registry"]
        Router["RPC Router"]
    end

    subgraph "Other Plugins"
        HC["healthcheck-backend"]
        Auth["auth-backend"]
    end

    SMTP --> EP
    Slack --> EP
    SMS --> EP
    EP --> Registry
    HC -->|"S2S RPC"| Router
    Auth -->|"S2S RPC"| Router
    Router --> Registry
```

## Core Concepts

### Namespaced Strategy IDs

Strategies are namespaced by their owning plugin's ID to prevent conflicts:

```typescript
// Plugin: notification-smtp-backend
// Strategy ID: smtp
// Qualified ID: notification-smtp.smtp
```

### Dynamic Permissions

Each registered strategy automatically generates a permission:

```
Format: {ownerPluginId}.strategy.{strategyId}.use
Example: notification-smtp.strategy.smtp.use
```

These permissions can be assigned to roles to control which users can receive notifications via specific channels.

### Contact Resolution

Strategies declare how they obtain user contact information:

| Type | Description | Example |
|------|-------------|---------|
| `auth-email` | Uses `user.email` from auth system | SMTP |
| `auth-provider` | Uses email from specific OAuth provider | Gmail-only notifications |
| `user-config` | User provides via settings form | SMS (phone number) |
| `oauth-link` | Requires OAuth flow | Slack, Discord |
| `custom` | Strategy handles resolution entirely | Custom integrations |

## Implementing a Strategy

### 1. Create Plugin Structure

```
plugins/notification-smtp-backend/
├── package.json
├── tsconfig.json
└── src/
    ├── plugin-metadata.ts
    └── index.ts
```

### 2. Define Configuration Schemas

Strategies can have up to three configuration layers:

```typescript
import { z } from "zod";
import { secret, color, Versioned } from "@checkmate/backend-api";

// Infrastructure config (SMTP server, API keys)
const smtpConfigSchemaV1 = z.object({
  host: z.string().describe("SMTP server hostname"),
  port: z.number().default(587).describe("SMTP server port"),
  secure: z.boolean().default(false).describe("Use TLS/SSL"),
  username: secret().optional().describe("SMTP username"),
  password: secret().optional().describe("SMTP password"),
  fromAddress: z.string().email().describe("Sender email address"),
  fromName: z.string().optional().describe("Sender display name"),
});

// Layout config (admin-customizable branding)
const smtpLayoutConfigSchemaV1 = z.object({
  logoUrl: z.string().url().optional().describe("Logo URL (max 200px wide)"),
  primaryColor: color("#3b82f6").describe("Primary brand color"),
  accentColor: color().optional().describe("Accent color for buttons"),
  footerText: z.string().default("This is an automated notification.").describe("Footer text"),
});
```

> **💡 Tip:** Use `color()` for hex color fields and `secret()` for sensitive data. These render as specialized inputs in the admin UI (color picker, password field).

### 3. Implement the Strategy Interface

```typescript
import { 
  NotificationStrategy, 
  Versioned,
  markdownToHtml,
  markdownToPlainText,
  wrapInEmailLayout,
} from "@checkmate/backend-api";

const smtpStrategy: NotificationStrategy<SmtpConfig, undefined, SmtpLayoutConfig> = {
  id: "smtp",
  displayName: "Email (SMTP)",
  description: "Send notifications via email using SMTP",
  icon: "mail",

  config: new Versioned({ version: 1, schema: smtpConfigSchemaV1 }),
  layoutConfig: new Versioned({ version: 1, schema: smtpLayoutConfigSchemaV1 }),

  contactResolution: { type: "auth-email" },

  async send({ contact, notification, strategyConfig, layoutConfig }) {
    // Convert markdown body to HTML (see "Semantic Body" section below)
    const bodyHtml = notification.body ? markdownToHtml(notification.body) : "";
    const plainText = notification.body 
      ? markdownToPlainText(notification.body) 
      : notification.title;

    // Wrap in email layout with admin branding
    const html = wrapInEmailLayout({
      title: notification.title,
      bodyHtml,
      importance: notification.importance,
      action: notification.action,
      logoUrl: layoutConfig?.logoUrl,
      primaryColor: layoutConfig?.primaryColor,
      accentColor: layoutConfig?.accentColor,
      footerText: layoutConfig?.footerText,
    });

    await transporter.sendMail({
      from: strategyConfig.fromAddress,
      to: contact,
      subject: notification.title,
      text: plainText,
      html,
    });

    return { success: true };
  },
};
```

### 4. Register via Extension Point

```typescript
import { createBackendPlugin } from "@checkmate/backend-api";
import { notificationStrategyExtensionPoint } from "@checkmate/notification-backend";
import { pluginMetadata } from "./plugin-metadata";

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    const extensionPoint = env.getExtensionPoint(
      notificationStrategyExtensionPoint
    );

    extensionPoint.addStrategy(smtpStrategy, pluginMetadata);
  },
});
```

## Semantic Notification Body

Notifications use **semantic Markdown content** that strategies convert to their native format. This ensures content is authored once and renders appropriately across all channels.

### The Pattern

```typescript
// Plugin sending a notification
await notificationApi.notifyUsers({
  userIds: ["user-1"],
  notification: {
    title: "Health Check Failed",
    body: "**System:** api-server\n\nThe system is now in **degraded** state.\n\n[View Details](https://...)",
    importance: "critical",
    action: { label: "View Dashboard", url: "https://..." },
    type: "healthcheck.alert",
  },
});
```

### Conversion Utilities

The platform provides utilities for converting markdown to target formats:

| Utility | Output | Use Case |
|---------|--------|----------|
| `markdownToHtml()` | HTML | Email body content |
| `markdownToPlainText()` | Plain text | SMS, fallback content |
| `markdownToSlackMrkdwn()` | Slack mrkdwn | Slack messages |

```typescript
import { 
  markdownToHtml, 
  markdownToPlainText, 
  markdownToSlackMrkdwn 
} from "@checkmate/backend-api";

// Email strategy
const bodyHtml = markdownToHtml(notification.body);

// SMS strategy  
const bodyText = markdownToPlainText(notification.body);

// Slack strategy
const mrkdwn = markdownToSlackMrkdwn(notification.body);
```

### Action Rendering

The `action` field provides a semantic call-to-action:

| Strategy | Rendering |
|----------|-----------|
| Email | Styled button with label and URL |
| SMS | Appended as plain-text link |
| Slack | Block Kit button |
| Push | Deep link in notification tap |

## Layout Configuration

Rich-content strategies (email) can support admin-customizable layouts:

### Defining Layout Config

```typescript
const layoutConfigSchema = z.object({
  logoUrl: z.string().url().optional().describe("Company logo URL"),
  primaryColor: color("#3b82f6").describe("Header/accent color"),
  accentColor: color().optional().describe("Button color"),
  footerText: z.string().default("Sent by Checkmate").describe("Footer text"),
});

const strategy: NotificationStrategy<Config, undefined, LayoutConfig> = {
  // ...other fields
  layoutConfig: new Versioned({ version: 1, schema: layoutConfigSchema }),
};
```

### Using wrapInEmailLayout()

The `wrapInEmailLayout()` utility generates a responsive HTML email template:

```typescript
import { wrapInEmailLayout } from "@checkmate/backend-api";

const html = wrapInEmailLayout({
  title: notification.title,
  bodyHtml: markdownToHtml(notification.body),
  importance: notification.importance,  // Affects header color
  action: notification.action,          // Renders as button
  // Admin-configurable branding:
  logoUrl: layoutConfig.logoUrl,
  primaryColor: layoutConfig.primaryColor,
  accentColor: layoutConfig.accentColor,
  footerText: layoutConfig.footerText,
});
```

**Features:**
- Responsive design (works on mobile)
- Compatible with major email clients
- Importance-based default colors (blue/amber/red)
- Optional logo, customizable colors, footer links


## Strategy Interface

```typescript
interface NotificationStrategy<TConfig = unknown, TUserConfig = undefined> {
  /** Strategy ID (namespace-qualified at runtime) */
  id: string;

  /** Display name for UI */
  displayName: string;

  /** Description */
  description?: string;

  /** Lucide icon name */
  icon?: string;

  /** Admin configuration schema */
  config: Versioned<TConfig>;

  /** Per-user configuration schema (optional) */
  userConfig?: Versioned<TUserConfig>;

  /** How contact info is resolved */
  contactResolution: NotificationContactResolution;

  /** Send a notification */
  send(
    context: NotificationSendContext<TConfig, TUserConfig>
  ): Promise<NotificationDeliveryResult>;

  /** Optional: OAuth linking URL */
  getOAuthLinkUrl?(userId: string, returnUrl: string): Promise<string | undefined>;

  /** Optional: Handle OAuth callback */
  handleOAuthCallback?(
    userId: string,
    params: Record<string, string>
  ): Promise<{ success: boolean; error?: string }>;
}
```

## User Preferences

Users can configure their notification preferences per strategy:

### Database Schema

```sql
CREATE TABLE user_notification_preferences (
  user_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,       -- Qualified: {pluginId}.{strategyId}
  config JSONB,                     -- User-specific config (validated via userConfig)
  enabled BOOLEAN DEFAULT true,     -- User can disable channel
  external_id TEXT,                 -- OAuth-linked external ID
  linked_at TIMESTAMP,
  PRIMARY KEY (user_id, strategy_id)
);
```

### Contact Resolution Flow

1. Strategy declares `contactResolution` type
2. Platform resolves contact based on type:
   - `auth-email`: Query user's email from auth system
   - `user-config`: Query from `userNotificationPreferences.config`
   - `oauth-link`: Query from `userNotificationPreferences.external_id`
3. Skip user if contact cannot be resolved

## S2S RPC Endpoints

Plugins send external notifications via S2S RPC:

```typescript
// Send to specific users via specific strategy
await notificationApi.sendExternal({
  userIds: ["user-1", "user-2"],
  strategyId: "notification-smtp.smtp", // optional, defaults to all enabled
  notification: {
    title: "Health Check Failed",
    description: "System 'api-server' is degraded",
    importance: "critical",
    type: "healthcheck.alert",
  },
});

// Send transactional message (bypasses user preferences)
await notificationApi.sendTransactional({
  userId: "user-1",
  strategyId: "notification-smtp.smtp",
  message: {
    title: "Password Reset",
    description: "Click the link to reset your password",
    type: "password-reset",
  },
});
```

## Best Practices

### 1. Use Versioned Configurations

Always use `Versioned<T>` for config schemas to support future migrations:

```typescript
const configV1 = z.object({ host: z.string() });
const configV2 = z.object({ host: z.string(), timeout: z.number() });

const migration: Migration<typeof configV1, typeof configV2> = {
  fromVersion: 1,
  toVersion: 2,
  description: "Add timeout field",
  migrate: (data) => ({ ...data, timeout: 30000 }),
};
```

### 2. Handle Errors Gracefully

Return descriptive error messages for debugging:

```typescript
async send(context) {
  try {
    await sendEmail(context);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
```

### 3. Use Branded Types for Special Fields

Use platform branded types for specialized UI and validation:

```typescript
import { secret, color } from "@checkmate/backend-api";

const config = z.object({
  // Secrets: rendered as password inputs, encrypted at rest
  apiKey: secret().describe("API key for service"),
  
  // Colors: rendered as color picker, validated as hex
  brandColor: color("#3b82f6").describe("Primary brand color"),
  accentColor: color().optional().describe("Optional accent"),
});
```

### 4. Convert Markdown to Native Formats

Always use the platform utilities for converting notification body content:

```typescript
import { markdownToHtml, markdownToPlainText } from "@checkmate/backend-api";

// Rich content (email)
const html = markdownToHtml(notification.body);

// Plain text (SMS, plain text email fallback)
const text = markdownToPlainText(notification.body);
```

### 5. Use Email Layout Wrapper

For email strategies, use `wrapInEmailLayout()` for consistent, responsive emails:

```typescript
import { wrapInEmailLayout } from "@checkmate/backend-api";

const html = wrapInEmailLayout({
  title: notification.title,
  bodyHtml: markdownToHtml(notification.body),
  importance: notification.importance,
  action: notification.action,
  ...layoutConfig,  // Admin branding
});
```

### 6. Provide User-Friendly Icons

Use Lucide icon names for consistent UI:

```typescript
const strategy = {
  icon: "mail",        // SMTP
  icon: "slack",       // Slack
  icon: "phone",       // SMS
  icon: "message-circle", // Generic messaging
};
```

## See Also

- [Plugin Development](./plugins.md)
- [Configuration Service](./config-service.md)
- [Versioned Configs](./versioned-configs.md)
- [Config Schemas (Frontend)](../frontend/config-schemas.md)
- [Signals](./signals.md)
