import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the integration plugin.
 *
 * The legacy subscription list / delivery log routes were removed when
 * the platform moved to the Automation Platform model. The remaining
 * surface is the per-provider connection management page.
 */
export const integrationRoutes = createRoutes("integration", {
  /** Main connections landing page */
  list: "/",
  /** Provider connections management */
  connections: "/connections/:providerId",
});
