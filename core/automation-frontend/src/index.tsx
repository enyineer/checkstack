import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import {
  automationRoutes,
  pluginMetadata,
  automationAccess,
} from "@checkstack/automation-common";
import { lazy } from "react";
import { AutomationMenuItems } from "./components/AutomationMenuItems";

// Lazy-loaded so each page body is a per-route chunk, not in the initial load.
const AutomationListPage = lazy(() =>
  import("./pages/AutomationListPage").then((m) => ({
    default: m.AutomationListPage,
  })),
);
const AutomationEditPage = lazy(() =>
  import("./pages/AutomationEditPage").then((m) => ({
    default: m.AutomationEditPage,
  })),
);
const RunsPage = lazy(() =>
  import("./pages/RunsPage").then((m) => ({ default: m.RunsPage })),
);
const RunDetailPage = lazy(() =>
  import("./pages/RunDetailPage").then((m) => ({ default: m.RunDetailPage })),
);
const TemplatePlaygroundPage = lazy(() =>
  import("./pages/TemplatePlaygroundPage").then((m) => ({
    default: m.TemplatePlaygroundPage,
  })),
);

export {
  generateAutomationContextTypes,
  generateSecretEnvTypes,
  secretEnvEnvNames,
  type GenerateAutomationContextTypesInput,
  type GenerateAutomationContextTypesResult,
} from "./script-context";

/**
 * Frontend plugin for the automation platform.
 *
 * Routes:
 *
 *   - `/automation/`                          → list view
 *   - `/automation/new`                       → blank edit page (create)
 *   - `/automation/:automationId`             → edit page
 *   - `/automation/:automationId/runs`        → run history
 *   - `/automation/:automationId/runs/:runId` → single run drill-down
 *   - `/automation/playground`                → template playground
 *
 * Run history pages and the playground are gated on `automation.read`;
 * everything that mutates state (create/edit/delete/toggle, manual run,
 * cancel run) further requires `automation.manage`. The edit page
 * downgrades gracefully — viewers can read the YAML but the Save / Run
 * Now / Delete controls disappear.
 *
 * No `foreignSignals` declared: every signal the automation domain
 * emits (`AUTOMATION_DEFINITION_CHANGED`, `AUTOMATION_RUN_*`) is owned
 * by this plugin, so the auto-invalidator wires it up for free. If
 * cross-domain signals matter later (e.g. invalidating the run list
 * when a remote incident closes), declare them here.
 */
export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: automationRoutes.routes.list,
      element: <AutomationListPage />,
      title: "Automations",
      accessRule: automationAccess.read,
    },
    {
      route: automationRoutes.routes.create,
      element: <AutomationEditPage />,
      title: "New automation",
      accessRule: automationAccess.manage,
    },
    {
      route: automationRoutes.routes.edit,
      element: <AutomationEditPage />,
      title: "Edit automation",
      accessRule: automationAccess.read,
    },
    {
      route: automationRoutes.routes.runs,
      element: <RunsPage />,
      title: "Run history",
      accessRule: automationAccess.read,
    },
    {
      route: automationRoutes.routes.runDetail,
      element: <RunDetailPage />,
      title: "Run details",
      accessRule: automationAccess.read,
    },
    {
      route: automationRoutes.routes.playground,
      element: <TemplatePlaygroundPage />,
      title: "Template playground",
      accessRule: automationAccess.read,
    },
  ],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "automation.user-menu.items",
      component: AutomationMenuItems,
      metadata: { group: "Automation" },
    }),
  ],
});
