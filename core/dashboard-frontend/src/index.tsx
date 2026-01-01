import { FrontendPlugin, DashboardSlot } from "@checkmate/frontend-api";
import { Dashboard } from "./Dashboard";

export const dashboardPlugin: FrontendPlugin = {
  name: "dashboard-frontend",
  extensions: [
    {
      id: "dashboard-main",
      slotId: DashboardSlot.id,
      component: Dashboard as React.ComponentType<unknown>,
    },
  ],
};

export default dashboardPlugin;
