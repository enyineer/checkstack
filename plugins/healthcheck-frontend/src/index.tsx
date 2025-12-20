import { createFrontendPlugin, fetchApiRef } from "@checkmate/frontend-api";
import { healthCheckApiRef, HealthCheckClient } from "./api";
import { HealthCheckConfigPage } from "./pages/HealthCheckConfigPage";
import { HealthCheckMenuItems } from "./components/HealthCheckMenuItems";
import { permissions } from "@checkmate/healthcheck-common";
import { SLOT_USER_MENU_ITEMS } from "@checkmate/common";

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
        const fetchApi = deps.get(fetchApiRef);
        return new HealthCheckClient(fetchApi);
      },
    },
  ],
  extensions: [
    {
      id: "healthcheck.user-menu.items",
      slotId: SLOT_USER_MENU_ITEMS,
      component: HealthCheckMenuItems,
    },
  ],
});
