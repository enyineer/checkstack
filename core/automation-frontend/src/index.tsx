import { createFrontendPlugin } from "@checkstack/frontend-api";
import {
  automationRoutes,
  pluginMetadata,
  automationAccess,
} from "@checkstack/automation-common";
import { Workflow } from "lucide-react";

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
      load: () =>
        import("./pages/AutomationListPage").then((m) => ({
          default: m.AutomationListPage,
        })),
      title: "Automations",
      accessRule: automationAccess.read,
      nav: { group: "Automation", icon: Workflow },
    },
    {
      route: automationRoutes.routes.create,
      load: () =>
        import("./pages/AutomationEditPage").then((m) => ({
          default: m.AutomationEditPage,
        })),
      title: "New automation",
      accessRule: automationAccess.manage,
    },
    {
      route: automationRoutes.routes.edit,
      load: () =>
        import("./pages/AutomationEditPage").then((m) => ({
          default: m.AutomationEditPage,
        })),
      title: "Edit automation",
      accessRule: automationAccess.read,
    },
    {
      route: automationRoutes.routes.runs,
      load: () => import("./pages/RunsPage").then((m) => ({ default: m.RunsPage })),
      title: "Run history",
      accessRule: automationAccess.read,
    },
    {
      route: automationRoutes.routes.runDetail,
      load: () =>
        import("./pages/RunDetailPage").then((m) => ({
          default: m.RunDetailPage,
        })),
      title: "Run details",
      accessRule: automationAccess.read,
    },
    {
      route: automationRoutes.routes.playground,
      load: () =>
        import("./pages/TemplatePlaygroundPage").then((m) => ({
          default: m.TemplatePlaygroundPage,
        })),
      title: "Template playground",
      accessRule: automationAccess.read,
    },
  ],
});
