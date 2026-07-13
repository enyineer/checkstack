import { createRoutes } from "@checkstack/common";

/**
 * Route definitions for the logstream plugin. Paths are relative to the
 * plugin's mount point (`/logstream`), so `home` resolves to `/logstream` and
 * `detail` to `/logstream/:streamId`.
 */
export const logstreamRoutes = createRoutes("logstream", {
  home: "/",
  detail: "/:streamId",
});
