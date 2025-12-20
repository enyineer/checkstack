import {
  createFrontendPlugin,
  discoveryApiRef,
  DiscoveryApi,
} from "@checkmate/frontend-api";
import { healthCheckApiRef, HealthCheckClient } from "./api";
import { HealthCheckConfigPage } from "./pages/HealthCheckConfigPage";
import { HealthCheckMenuItems } from "./components/HealthCheckMenuItems";
import { permissions } from "@checkmate/healthcheck-common";

export default createFrontendPlugin({
  name: "healthcheck-frontend",
  routes: [
    {
      path: "/healthcheck/config",
      element: <HealthCheckConfigPage />,
      title: "Health Checks",
      permission: permissions.healthCheckRead.id,
    },
  ],
  apis: [
    {
      ref: healthCheckApiRef,
      factory: (deps) => {
        const discoveryApi = deps.get(discoveryApiRef) as DiscoveryApi;
        return new HealthCheckClient(discoveryApi);
      },
    },
  ],
  extensions: [
    {
      id: "healthcheck.user-menu.items",
      slotId: "core.layout.navbar.user-menu.items",
      component: HealthCheckMenuItems,
    },
  ],
});
