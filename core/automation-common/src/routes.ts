import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the automation plugin.
 */
export const automationRoutes = createRoutes("automation", {
  /** Automation list page */
  list: "/",
  /** Create new automation */
  create: "/new",
  /** Edit a single automation */
  edit: "/:automationId",
  /** Run history for a single automation */
  runs: "/:automationId/runs",
  /** Drill into a single run */
  runDetail: "/:automationId/runs/:runId",
  /** Template playground (live preview of templates with sample payloads) */
  playground: "/playground",
});
