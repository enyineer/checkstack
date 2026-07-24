import { createFrontendPlugin } from "@checkstack/frontend-api";
import {
  pluginMetadata,
  ANNOUNCEMENTS_WIDGET_ID,
} from "@checkstack/announcement-common";
import { defineStatusWidgetRenderer } from "@checkstack/status-page-common";
import { StatusAnnouncementsWidget } from "./components/StatusAnnouncementsWidget";

/**
 * The LEAN entry the lean public status-page bundle loads as a Module Federation
 * remote (`vite.config.ts` exposes this as `./plugin`). It contributes ONLY the
 * announcement status-widget renderer - no admin routes, no dashboard slot - so
 * the remote pulls in `StatusAnnouncementsWidget` and its small `@checkstack/ui`
 * surface (MarkdownBlock / StatusPill / cn) and nothing else. Exposing the full
 * admin `index.tsx` instead would drag in the manage page's `DataTable` ->
 * `@tanstack/react-virtual`, whose `flushSync` import breaks the federated
 * `react-dom` consume shim (and needlessly bloats a public bundle).
 *
 * The admin app still bundles the FULL plugin (`index.tsx`) via `import.meta.
 * glob`; this file exists solely for the public remote.
 */
export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [],
  apis: [],
  extensions: [
    defineStatusWidgetRenderer({
      pluginMetadata,
      id: ANNOUNCEMENTS_WIDGET_ID,
      component: StatusAnnouncementsWidget,
    }),
  ],
});
