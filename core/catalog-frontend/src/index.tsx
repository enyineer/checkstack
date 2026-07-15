import { createFrontendPlugin } from "@checkstack/frontend-api";
import {
  catalogRoutes,
  pluginMetadata,
  catalogAccess,
  catalogResourceTypes,
} from "@checkstack/catalog-common";

import { Server, FolderTree } from "lucide-react";
import { registerSubjectKind } from "@checkstack/notification-frontend";

// Notification subject kinds emitted by catalog (see catalog-common's
// `createSystemSubject` / `createGroupSubject`). Registered at module load
// so the notification bell + page render kind-appropriate icons.
registerSubjectKind(`${pluginMetadata.pluginId}.system`, {
  label: "System",
  icon: Server,
});
registerSubjectKind(`${pluginMetadata.pluginId}.group`, {
  label: "Group",
  icon: FolderTree,
});

export const catalogPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  // No APIs needed - components use usePluginClient() directly
  apis: [],
  routes: [
    {
      route: catalogRoutes.routes.home,
      load: () =>
        import("./components/CatalogPage").then((m) => ({
          default: m.CatalogPage,
        })),
      title: "Catalog",
      nav: {
        group: "Workspace",
        icon: Server,
        // Visible to anyone who can view systems in the catalog.
        accessRule: catalogAccess.system.read,
      },
    },
    {
      route: catalogRoutes.routes.config,
      load: () =>
        import("./components/CatalogConfigPage").then((m) => ({
          default: m.CatalogConfigPage,
        })),
      accessRule: catalogAccess.system.manage,
      // Team-scoped: managing any system unlocks the catalog management surface
      // (they can edit their systems even without the global manage rule).
      manageCapability: { objectType: catalogResourceTypes.system },
    },
    {
      route: catalogRoutes.routes.systemDetail,
      load: () =>
        import("./components/SystemDetailPage").then((m) => ({
          default: m.SystemDetailPage,
        })),
    },
  ],
  extensions: [],
});

export * from "./api";

// Reusable "Preview as: <environment>" picker + its DOM-free helpers, so host
// plugins can let config authors preview `x-templatable` fields against a
// catalog environment's custom fields.
export { EnvironmentPreviewPicker } from "./components/EnvironmentPreviewPicker";
export {
  toPreviewOptions,
  environmentToPreviewFields,
  findSelectedEnvironment,
  type EnvironmentPreviewOption,
} from "./components/environment-preview.logic";

// Shared editor for a stream's EXPLICIT links to catalog systems, embedded by
// the stream plugins (logstream / metricstream / tracestream) in their Settings
// tabs. Same-layer import: the stream frontends consume this catalog-centric
// picker directly.
export {
  StreamSystemLinksEditor,
  type StreamSystemLinksEditorProps,
  type StreamSystemSuggestions,
} from "./components/StreamSystemLinksEditor";

// Shared "Linked systems" SETTINGS card - owns the draft/dirty/save semantics
// once so the three stream Settings tabs cannot drift. The plugin supplies its
// gated `setSystemLinks` mutation via props.
export {
  StreamSystemLinksSettingsCard,
  type StreamSystemLinksSettingsCardProps,
} from "./components/StreamSystemLinksSettingsCard";

// Shared presentational card listing a system's linked streams for one signal,
// used by each stream plugin's `SystemDetailsSlot` filler so the Logs/Metrics/
// Traces cards on a system detail page share identical chrome.
export {
  LinkedStreamsCard,
  type LinkedStreamsCardProps,
  type LinkedStreamItem,
} from "./components/LinkedStreamsCard";
