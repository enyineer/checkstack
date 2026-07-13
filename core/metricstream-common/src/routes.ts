import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the metricstream plugin. Paths are relative to the
 * plugin's mount point (`/metricstream`), so `home` resolves to `/metricstream`
 * and `detail` to `/metricstream/:streamId`.
 */
export const metricstreamRoutes = createRoutes("metricstream", {
  home: "/",
  detail: "/:streamId",
});
