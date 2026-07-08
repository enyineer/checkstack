import React, { useState } from "react";
import { Link } from "react-router-dom";
import { usePluginClient, wrapInSuspense } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import { MaintenanceApi } from "../api";
import { maintenanceRoutes } from "@checkstack/maintenance-common";
import {
  Card,
  CardContent,
  LoadingSpinner,
  EmptyState,
  PageLayout,
  Checkbox,
  Label,
  cn,
} from "@checkstack/ui";
import { Wrench, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import {
  getMaintenanceStatusBadge,
  getMaintenanceStatusTone,
  getMaintenanceToneAccentClass,
} from "../utils/badges";

/**
 * Public, read-only overview of maintenance windows. Reachable logged-out
 * (anonymous holds `maintenance.read` by default) via the sidebar. Uses the
 * already-public `listMaintenances` proc, whose `listKey` post-filter scopes
 * rows to the caller's grants. Managing/editing stays on the separate
 * manage-gated config page.
 */
const MaintenanceOverviewPageContent: React.FC = () => {
  const maintenanceClient = usePluginClient(MaintenanceApi);
  const [includeCompleted, setIncludeCompleted] = useState(false);

  const { data, isLoading } = maintenanceClient.listMaintenances.useQuery({
    includeCompleted,
  });

  const maintenances = data?.maintenances ?? [];

  return (
    <PageLayout
      title="Maintenances"
      subtitle="Upcoming and in-progress maintenance windows"
      icon={Wrench}
      loading={false}
      allowed={true}
      actions={
        <div
          className="flex items-center gap-2"
          onClick={() => setIncludeCompleted((v) => !v)}
        >
          <Checkbox id="include-completed" checked={includeCompleted} />
          <Label htmlFor="include-completed" className="cursor-pointer text-sm">
            Show completed
          </Label>
        </div>
      }
    >
      {isLoading ? (
        <div className="p-12 flex justify-center">
          <LoadingSpinner />
        </div>
      ) : maintenances.length === 0 ? (
        <EmptyState
          title="No maintenances"
          description={
            includeCompleted
              ? "There are no maintenance windows to show."
              : "There are no upcoming or in-progress maintenance windows."
          }
        />
      ) : (
        <div className="space-y-3">
          {maintenances.map((maintenance) => (
            <Link
              key={maintenance.id}
              to={resolveRoute(maintenanceRoutes.routes.detail, {
                maintenanceId: maintenance.id,
              })}
              className="block"
            >
              <Card className="relative overflow-hidden transition-colors hover:bg-muted/40">
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 w-1",
                    getMaintenanceToneAccentClass(
                      getMaintenanceStatusTone(maintenance.status),
                    ),
                  )}
                  aria-hidden
                />
                <CardContent className="flex items-center justify-between gap-4 p-4 pl-5">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {maintenance.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {format(new Date(maintenance.startAt), "PPp")} -{" "}
                      {format(new Date(maintenance.endAt), "PPp")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {getMaintenanceStatusBadge(maintenance.status)}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageLayout>
  );
};

export const MaintenanceOverviewPage = wrapInSuspense(
  MaintenanceOverviewPageContent,
);
