# Infrastructure Configuration

The Infrastructure Configuration system provides a centralized, pluggable settings page for infrastructure concerns (Queue, Cache, etc.).

## Architecture

```
core/infrastructure-common    → Tab registry, routes, shared types
core/infrastructure-frontend  → Shell page (IDE Editor pattern), user menu
```

## Design Pattern — IDE Editor Tabs

The Infrastructure Settings page uses a vertical tab bar on the left with a content area on the right, similar to an IDE editor's settings panel:

```
┌────────────────┬──────────────────────────────┐
│  🔧 Queue      │                              │
│  💾 Cache      │   [Active Tab Content]       │
│                │                              │
│                │                              │
└────────────────┴──────────────────────────────┘
```

## Tab Registration

Plugins register their configuration tabs via `registerInfrastructureTab()`:

```typescript
import { registerInfrastructureTab } from "@checkstack/infrastructure-common";

registerInfrastructureTab({
  id: "queue",
  pluginId: pluginMetadata.pluginId,
  label: "Queue",
  icon: Gauge,
  component: QueueConfigTab,
  readAccess: queueAccess.settings.read,
  manageAccess: queueAccess.settings.manage,
  order: 10,
});
```

### InfrastructureTab Interface

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique tab identifier |
| `pluginId` | `string` | Plugin that owns this tab (for access rule qualification) |
| `label` | `string` | Display label |
| `icon` | `React.ComponentType` | Icon component |
| `component` | `React.ComponentType<{ canUpdate: boolean }>` | Tab content |
| `readAccess` | `AccessRule` | Required to view this tab |
| `manageAccess` | `AccessRule` | Required to modify settings |
| `order` | `number` (optional) | Sort order (lower = first) |

## Per-Tab Access Control

The Infrastructure shell evaluates each tab's `readAccess` rule against the current user. Only tabs the user has permission to view are rendered. The `manageAccess` rule is passed as `canUpdate` to the tab component.

If the user has no access to any tab, the page shows an "Access Denied" message.

## Tab Component Contract

Tab components receive a single prop:

```typescript
interface TabProps {
  canUpdate: boolean;
}
```

The component should disable edit controls when `canUpdate` is `false`.

## User Menu Integration

The `InfrastructureUserMenuItems` component checks if the user has access to **any** infrastructure tab. If so, it renders a menu item linking to `/infrastructure/config`.

## Migration from Standalone Routes

Prior to the Infrastructure Configuration system, each infrastructure concern (Queue) had its own standalone route (e.g., `/queue/config`). The migration pattern:

1. Extract page content into a tab component (e.g., `QueueConfigTab`)
2. Remove `PageLayout` wrapper (the shell provides it)
3. Accept `canUpdate` as a prop instead of querying access internally
4. Register the tab in the plugin's `index.tsx` via `registerInfrastructureTab()`
5. Remove the standalone route and user menu extension
