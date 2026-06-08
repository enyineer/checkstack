import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the automation plugin.
 */
export const automationRoutes = createRoutes("automation", {
  /** Automation list page */
  list: "/",
  /** Pick a starting point (example-template gallery) for a new automation */
  create: "/new",
  /**
   * Blank / template-seeded editor for a new automation. Reached from the
   * picker; a `?template=<id>` query param seeds the editor from that template.
   */
  createBlank: "/new/blank",
  /** Edit a single automation */
  edit: "/:automationId",
  /** Run history for a single automation */
  runs: "/:automationId/runs",
  /** Drill into a single run */
  runDetail: "/:automationId/runs/:runId",
  /** Template playground (live preview of templates with sample payloads) */
  playground: "/playground",
});
