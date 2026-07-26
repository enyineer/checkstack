---
title: "Extension Points and Strategies"
description: "Slot-based extension points that let plugins provide pluggable implementations for core functionality via the strategy pattern."
---

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
import { HealthCheckStrategy } from "@checkstack/backend-api";

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
import { healthCheckExtensionPoint } from "@checkstack/backend-api";

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
  username: z.string().default("Checkstack"),
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
> import { coreServices } from "@checkstack/backend-api";
> import { AuthApi } from "@checkstack/auth-common";
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
> This ensures administrators have full control over user registration across all authentication methods. See [Backend Service Communication](/checkstack/developer-guide/backend/services/) for more details on using the RPC client.

## Frontend Extension Points

### Slots

Slots allow plugins to inject UI components into predefined locations. Plugins can either:
1. Register extensions to **core slots** defined in `@checkstack/frontend-api`
2. Register extensions to **plugin-defined slots** exported from plugin common packages

#### Core Slots (from `@checkstack/frontend-api`)

Core slots are defined using the `createSlot` utility and exported as `SlotDefinition` objects:

```typescript
import {
  DashboardSlot,
  NavbarRightSlot,
  NavbarLeftSlot,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
```

#### Plugin-Defined Slots

Plugins can expose their own slots using the `createSlot` utility from `@checkstack/frontend-api`. This allows other plugins to extend specific areas of your plugin's UI.

**Example: Catalog plugin exposing slots (from `@checkstack/catalog-common`)**

```typescript
import { createSlot } from "@checkstack/frontend-api";
import type { System } from "./types";

// Slot for extending the System Details page
export const SystemDetailsSlot = createSlot<{ system: System }>(
  "plugin.catalog.system-details"
);

// Slot for adding actions to the system configuration page
export const CatalogSystemActionsSlot = createSlot<{
  systemId: string;
  systemName: string;
  // Every system id currently visible in this row's list. A filler that shows
  // per-system data can bulk-fetch for the whole visible set in ONE deduped
  // request keyed on this array, instead of one request per row (an N+1). Every
  // row receives the same ids, so identical-input queries collapse to one call.
  visibleSystemIds: string[];
}>("plugin.catalog.system-actions");
```

> [!TIP]
> Use `visibleSystemIds` for any per-system data a per-row action needs (for
> example the health-check count badge). Fetch a bulk endpoint keyed on the whole
> array from each row; because every row passes the same ids, the queries dedupe
> to a single request rather than fanning out one request per system.

##### `CatalogBrowseHealthSlot` (bulk health rollup)

The catalog browse view surfaces a group-level health rollup without depending on any health provider. It does this through the optional `CatalogBrowseHealthSlot` contract: catalog only **consumes** the slot, and a health provider plugin **fills** it.

The slot context passes the visible system ids and a callback the filler reports statuses to:

```typescript
export type CatalogHealthStatus = "healthy" | "degraded" | "unhealthy";
export type CatalogHealthStatuses = Record<string, CatalogHealthStatus>;

export interface CatalogBrowseHealthSlotContext {
  systemIds: string[];
  onStatuses: (statuses: CatalogHealthStatuses) => void;
}

export const CatalogBrowseHealthSlot =
  createSlot<CatalogBrowseHealthSlotContext>("plugin.catalog.browse-health");
```

Contract rules:

- The filler renders nothing visible. It is a headless data boundary that bulk-fetches health for `systemIds` and reports the resolved statuses via `onStatuses`.
- `CatalogHealthStatus` is catalog's own vocabulary. A filler maps its own status enum into these three values so catalog stays decoupled from the provider's types.
- A system **absent** from the reported map is treated as `"unknown"` by the catalog rollup, never as healthy. This matters because healthy systems emit no per-system badge, so "all healthy" can only be derived from the reported data, not from rendered output.
- When the slot is unfilled (no health provider installed), group headers show member counts only and the health filter is disabled. Catalog remains fully functional.

Per-system badges continue to come from `SystemStateBadgesSlot`; this slot exists only to feed the group-level rollup and the health filter from the underlying status data.

Example filler (the health-provider side owns all cross-plugin coupling):

```tsx
import { createSlotExtension } from "@checkstack/frontend-api";
import { CatalogBrowseHealthSlot } from "@checkstack/catalog-common";

createSlotExtension(CatalogBrowseHealthSlot, {
  id: "my-plugin.catalog.browse-health",
  load: () =>
    import("./CatalogBrowseHealthFiller").then((m) => ({
      default: m.CatalogBrowseHealthFiller,
    })),
});
```

##### `CatalogBrowseDataBoundarySlot` (bulk data for per-row contributions)

The catalog browse view AND the catalog management systems table mount small
contributions on every system row - state badges (`SystemStateBadgesSlot`), a
notification bell, and so on. Rendered naively, each one fetches its own data, so
a catalog with N systems issues O(N) requests on open (an N+1). This slot removes
that without coupling catalog to any provider: catalog only **renders** the
boundary (around the browse tree and around the manage systems table), and a
provider plugin **fills** it with a component that wraps the tree in a bulk-data
provider. The manage table surfaces no group rows, so it passes an empty
`groupIds`; a filler's group-badge provider then fetches nothing there.

```typescript
export interface CatalogBrowseDataBoundarySlotContext {
  systemIds: string[]; // every system id currently rendered in the browse view
  groupIds: string[]; // every real group id rendered (excludes the ungrouped section)
}

export const CatalogBrowseDataBoundarySlot =
  createSlot<CatalogBrowseDataBoundarySlotContext>(
    "plugin.catalog.browse-data-boundary",
  );
```

Contract rules:

- A filler is an **eager** component that receives the context plus React
  `children` (type `children` as optional so the component stays assignable to
  the slot context, which does not declare it) and MUST render `children`
  **exactly once** inside its provider. The per-row contributions inside then
  read bulk data from that provider's React context and issue no per-row request.
- catalog-frontend folds **every** registered filler around the tree, so multiple
  providers nest and the tree still renders exactly once. Nesting order between
  fillers is irrelevant (each provides its own context).
- When no filler is installed, the boundary renders the tree unchanged and each
  contribution falls back to its own fetch - catalog stays fully functional.
- Keep the filler a pure data provider (no visible output of its own).

Example filler (dashboard-frontend wraps its existing bulk badge-data provider):

```tsx
import { createSlotExtension } from "@checkstack/frontend-api";
import { CatalogBrowseDataBoundarySlot } from "@checkstack/catalog-common";
import { SystemBadgeDataProvider } from "@checkstack/dashboard-frontend";

const CatalogBrowseBadgeDataFiller = ({
  systemIds,
  children,
}: {
  systemIds: string[];
  groupIds: string[];
  children?: React.ReactNode;
}) => (
  <SystemBadgeDataProvider systemIds={systemIds}>
    {children}
  </SystemBadgeDataProvider>
);

createSlotExtension(CatalogBrowseDataBoundarySlot, {
  id: "my-plugin.catalog.browse-boundary",
  component: CatalogBrowseBadgeDataFiller, // eager, NOT lazy `load`
});
```

##### `HealthCheckConfigOptionsResolverSlot` (check-editor dropdown resolvers)

The health-check editor renders every strategy's config and collector forms
generically via `DynamicForm`. A schema field annotated with
`x-options-resolver: "<name>"` renders as a dropdown only when a matching
resolver function is supplied - and the editor cannot know any strategy's
resolvers without importing the strategy's plugin (a forbidden dependency
direction). This slot inverts that: healthcheck-frontend defines the point and
the strategy's owning plugin contributes the resolvers as static metadata.

```typescript
import { createSlotExtension } from "@checkstack/frontend-api";
import { HealthCheckConfigOptionsResolverSlot } from "@checkstack/healthcheck-frontend";

createSlotExtension(HealthCheckConfigOptionsResolverSlot, {
  id: "logstream.healthcheck.options-resolvers",
  component: () => null, // metadata-only contribution, never rendered
  metadata: {
    strategyId: "logstream",
    buildResolvers: ({ rpcApi, strategyConfig }) => ({
      logstreamStreamId: async () => {
        const client = rpcApi.forPlugin(LogstreamApi);
        const streams = await client.listStreamsForPicker();
        return streams.map((s) => ({ value: s.id, label: s.name }));
      },
    }),
  },
});
```

Contract rules:

- `strategyId` is the unqualified strategy id; the editor only invokes factories
  whose id matches the strategy being edited.
- `buildResolvers` is a plain synchronous function (no hooks). It receives the
  generic `rpcApi` (scope it with `rpcApi.forPlugin(...)`) and the CURRENT
  strategy-config values, which is how a collector-field resolver can depend on
  a sibling strategy-form selection (the log-stream pattern picker reads the
  chosen `streamId` this way).
- Backend procedures called by resolvers should be `typeScoped` (or otherwise
  reachable by team-scoped managers), so the dropdown populates for every user
  who can legitimately edit the check.
- When no contribution matches, the annotated field degrades to a plain text
  input; the editor stays fully functional.

##### `SystemSignalsSlot` (dashboard "needs attention" overview)

The dashboard overview lists only the systems that need attention and hides
healthy ones. It builds that list entirely from signals reported through the
`SystemSignalsSlot` contract, so it is **agnostic to which plugins contribute**:
the dashboard only consumes the slot, and any plugin (including third-party
plugins) fills it to add a new kind of per-system state to the overview. Adding
a new signal source requires no dashboard change.

A signal carries everything the overview needs to surface, sort, count, and
deep-link the issue:

```typescript
export type SystemSignalTone = "error" | "warn" | "info";

export interface SystemSignal {
  source: string; // stable source id, e.g. "incident" - dedupes re-reports
  tone: SystemSignalTone; // drives colour, sort order, and the header counts
  label: string; // short label, e.g. "Critical incident"
  detail?: string; // optional context, e.g. the incident title
  href?: string; // deep link to where the issue originates
  accessRule?: AccessRule; // rule required to open href; see contract rules below
  since?: string; // ISO start time - shown as "since" and used as a tie-break
  iconName?: IconName; // lucide icon name, rendered via DynamicIcon
}

export type SystemSignalsMap = Record<string, SystemSignal[]>; // keyed by systemId

export interface SystemSignalsSlotContext {
  systemIds: string[];
  onSignals: (sourceId: string, signals: SystemSignalsMap) => void;
}

export const SystemSignalsSlot = createSlot<SystemSignalsSlotContext>(
  "plugin.catalog.system-signals",
);
```

Contract rules:

- The filler renders nothing visible. It is a headless data boundary that
  bulk-fetches its state for `systemIds` (no N+1) and reports a per-system-id
  signal map via `onSignals`, tagged with its own stable `sourceId`.
- Re-reporting with the same `sourceId` **replaces** that source's previous
  contribution, so a source that reports an empty map clears its signals.
- A system **absent** from every source's map has no signals and is hidden from
  the overview (it is healthy). The dashboard derives the "all healthy" state,
  the severity counts, and the sort order purely from the reported DATA, never
  from rendered output.
- Sort order is worst tone first (`error` -> `warn` -> `info`), matching the
  icon-only `StatusBadge` ordering used elsewhere.
- Set `accessRule` whenever `href` points at a permission-gated page. The
  dashboard renders the signal as a LINK only if the current user satisfies that
  rule, and as plain TEXT otherwise - so a user is never offered a deep link that
  would immediately hit "Access Denied". Omit `accessRule` only when the target
  needs no specific permission (the link is then always rendered).

Each core reliability plugin (healthcheck, incident, SLO, maintenance, anomaly,
dependency) ships a filler for this slot. A third-party plugin adds a new signal
type the same way:

```tsx
import { createSlotExtension } from "@checkstack/frontend-api";
import { SystemSignalsSlot } from "@checkstack/catalog-common";

createSlotExtension(SystemSignalsSlot, {
  id: "my-plugin.dashboard.signals",
  load: () =>
    import("./MySignalsFiller").then((m) => ({
      default: m.MySignalsFiller,
    })),
});
```

##### `AboutSectionsSlot` (platform About page)

The **About Checkstack** page (`@checkstack/about-frontend`) is a general,
platform-owned surface, so it must not depend on any specific plugin. It exposes
`AboutSectionsSlot` (from `@checkstack/about-common`) for plugins to CONTRIBUTE
self-contained section cards; the About page only renders whatever is registered.
This inverts the dependency: the owning plugin imports `@checkstack/about-common`,
never the other way round.

```typescript
import { createSlot } from "@checkstack/frontend-api";

export const AboutSectionsSlot = createSlot<undefined, { priority?: number }>(
  "plugin.about.sections",
);
```

Contract rules:

- Each contribution is fully self-contained: it renders its own card and gates
  itself (returning `null` when the viewer lacks the relevant access rule), so
  it never fires a request the viewer is not permitted to make.
- Extensions declare an optional `priority` in their metadata; the page renders
  them sorted ascending (lower first), mirroring `DashboardSlot`. Unspecified
  priority defaults to 0.

```tsx
import { createSlotExtension } from "@checkstack/frontend-api";
import { AboutSectionsSlot } from "@checkstack/about-common";

createSlotExtension(AboutSectionsSlot, {
  id: "my-plugin.about.section",
  metadata: { priority: 10 },
  load: () =>
    import("./MyAboutSection").then((m) => ({ default: m.MyAboutSection })),
});
```

#### Registering Extensions to Slots

Extensions use the `slot:` property with a `SlotDefinition` object:

**To a core slot:**
```typescript
import { UserMenuItemsSlot } from "@checkstack/frontend-api";

export const myPlugin = createFrontendPlugin({
  name: "myplugin-frontend",
  extensions: [
    {
      id: "myplugin.user-menu.account-item",
      slot: UserMenuItemsSlot,
      metadata: { priority: 50 },
      component: MyAccountMenuItem,
    },
  ],
});
```

> [!NOTE]
> Primary **navigation** is NOT a user-menu extension. The user menu is
> account-only (profile, theme, logout); to add a page to the left sidebar, give
> its route `nav` metadata - see
> [Frontend Routing](/checkstack/developer-guide/frontend/routing/#sidebar-navigation).

**To a plugin-defined slot:**
```typescript
import { SystemDetailsSlot } from "@checkstack/catalog-common";

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
import { createFrontendPlugin, createSlotExtension } from "@checkstack/frontend-api";
import { SystemDetailsSlot, CatalogSystemActionsSlot } from "@checkstack/catalog-common";

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
      component: MySystemAction, // Must accept { systemId; systemName; visibleSystemIds }
    }),
  ],
});
```

**Using `SlotContext` for component typing:**
```typescript
import type { SlotContext } from "@checkstack/frontend-api";
import { CatalogSystemActionsSlot } from "@checkstack/catalog-common";

// Props inferred directly from the slot definition - no manual interface needed!
type Props = SlotContext<typeof CatalogSystemActionsSlot>;
// Equivalent to: { systemId: string; systemName: string; visibleSystemIds: string[] }

export const MySystemAction: React.FC<Props> = ({ systemId, systemName }) => {
  // Full type safety - no casting, no unknown!
  return <Button onClick={() => doSomething(systemId)}>Action for {systemName}</Button>;
};
```

> [!TIP]
> Using `SlotContext` and `createSlotExtension` ensures compile-time type checking. If the slot definition changes, TypeScript will immediately flag any component prop mismatches.

#### Eager `component` vs lazy `load`

Every extension provides exactly one of `component` or `load`:

- `component` (eager) - bundled with the plugin and registered at load. Use for
  LIGHT, always-rendered contributions (navbar items, user-menu links, status
  badges) where code-splitting would only add a load flash.
- `load` (lazy) - a `() => import(...).then((m) => ({ default: m.X }))` thunk.
  The framework renders it through `React.lazy` inside a Suspense boundary and a
  per-plugin error boundary, so its chunk is fetched on demand and a failed load
  is contained to that one contribution. Use for HEAVY or page-scoped
  contributions (dashboards, editors, chart panels).

```typescript
createSlotExtension(SystemEditorSlot, {
  id: "myplugin.system-editor",
  // Heavy editor → lazy; only loads when the editor slot renders.
  load: () =>
    import("./components/MyEditor").then((m) => ({ default: m.MyEditor })),
});
```

If you read extensions yourself via `useSlotExtensions` (e.g. to build a tab
bar) instead of `<ExtensionSlot>`, render each one with the `<ExtensionComponent
extension={ext} context={...} />` helper so both eager and lazy contributions
are handled uniformly.

#### Typed Metadata on Extensions

Some slots need each extension to declare a static descriptor at registration
time - for example, the Infrastructure Settings tab bar needs a label, icon,
and access rules to render its nav before the tab body is mounted. Pass a
second type argument to `createSlot` to express that contract:

```typescript
import { createSlot } from "@checkstack/frontend-api";
import type { AccessRule } from "@checkstack/common";

export interface InfrastructureTabContext {
  canUpdate: boolean;
}

export interface InfrastructureTabMetadata {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  readAccess: AccessRule;
  manageAccess: AccessRule;
  order?: number;
}

export const InfrastructureTabsSlot = createSlot<
  InfrastructureTabContext,
  InfrastructureTabMetadata
>("infrastructure.tabs");
```

Extensions for a slot whose metadata type is non-`undefined` must supply a
`metadata` field; `createSlotExtension` will type-check it:

```typescript
createSlotExtension(InfrastructureTabsSlot, {
  id: "queue.infrastructure.tab",
  component: QueueInfrastructureTab,
  metadata: {
    label: "Queue",
    icon: Gauge,
    readAccess: queueAccess.settings.read,
    manageAccess: queueAccess.settings.manage,
    order: 10,
  },
});
```

Consumers read metadata via `useSlotExtensions`, which subscribes to plugin
register/unregister events:

```typescript
import { useSlotExtensions } from "@checkstack/frontend-api";

const tabs = useSlotExtensions(InfrastructureTabsSlot);
// tabs[i].metadata is typed as InfrastructureTabMetadata
```

`<ExtensionSlot slot={…} context={…} />` remains the right tool when the
consumer just needs to render every extension inline. Reach for
`useSlotExtensions` only when you need metadata, ordering, or per-extension
gating logic.

#### Example: User Menu Extension

The user menu slot (`UserMenuItemsSlot`) receives a `UserMenuItemsContext` with pre-fetched user data for synchronous rendering:

```typescript
interface UserMenuItemsContext {
  accessRules: string[];      // Pre-fetched user access rules
  hasCredentialAccount: boolean;  // Whether user has credential auth
}
```

**Access-gated menu item:**
```typescript
import type { UserMenuItemsContext } from "@checkstack/frontend-api";
import { qualifyAccessRuleId, resolveRoute } from "@checkstack/common";
import { access, pluginMetadata, myRoutes } from "@checkstack/myplugin-common";
import { DropdownMenuItem } from "@checkstack/ui";
import { Link } from "react-router";
import { Settings } from "lucide-react";

export const MyPluginMenuItems = ({
  accessRules: userPerms,
}: UserMenuItemsContext) => {
  const qualifiedId = qualifyAccessRuleId(pluginMetadata, access.myAccess);
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
import { createSlotExtension, UserMenuItemsSlot } from "@checkstack/frontend-api";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "myplugin.user-menu.items",
      metadata: { priority: 50 },
      component: MyPluginMenuItems,
    }),
  ],
});
```

**Ordering menu items**

Extensions render below the profile header, ordered by their optional
`priority` (ascending, lower first). Extensions that omit it default to `0`
and keep their registration order, which depends on plugin load order - so
declare a `priority` whenever position matters. The core contributions leave
gaps for third-party plugins to slot between them:

| Priority | Contribution |
|---|---|
| `-10` | Help (`tips-frontend`) |
| `10` / `20` / `30` | Theme, Low Power, Density (`theme-frontend`) |
| `40` | About (`about-frontend`) |
| `100` | Logout (`auth-frontend`) |

To render a visual divider above your section, emit a `DropdownMenuSeparator`
as your component's first child.

> [!NOTE]
> The desktop user menu is a two-column grid. A menu item that should occupy
> the full width (a section header, a legend, a separator) needs
> `col-span-full`. `DropdownMenuLabel` and `DropdownMenuSeparator` already
> carry it.

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
import { createExtensionPoint } from "@checkstack/backend-api";

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
// e.g., in @checkstack/myplugin-common/src/slots.ts
import { createSlot } from "@checkstack/frontend-api";

// Define with typed context that extensions will receive
export const MyPluginCustomSlot = createSlot<{ itemId: string }>(
  "myplugin.custom.slot"
);

// 2. Export from your common package index
export * from "./slots";

// 3. Use the slot in your plugin's frontend component
import { ExtensionSlot } from "@checkstack/frontend-api";
import { MyPluginCustomSlot } from "@checkstack/myplugin-common";

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
// e.g., in @checkstack/other-plugin-frontend
import { MyPluginCustomSlot } from "@checkstack/myplugin-common";

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

- [Backend Plugin Development](/checkstack/developer-guide/backend/plugins/)
- [Frontend Plugin Development](/checkstack/developer-guide/frontend/plugins/)
- [Versioned Configurations](/checkstack/developer-guide/backend/versioned-configs/)
- [Contributing Guide](/checkstack/developer-guide/getting-started/contributing/)
