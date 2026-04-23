import React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  Button,
  Badge,
} from "@checkstack/ui";
import { Link } from "react-router-dom";
import { usePluginRoute, useApi, accessApiRef } from "@checkstack/frontend-api";
import {
  maintenanceRoutes,
  maintenanceAccess,
  type MaintenanceWithSystems,
} from "@checkstack/maintenance-common";
import { resolveRoute } from "@checkstack/common";
import type { System } from "@checkstack/catalog-common";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maintenances: MaintenanceWithSystems[];
  systems: System[];
}

export const MaintenanceOverviewSheet: React.FC<Props> = ({
  open,
  onOpenChange,
  maintenances,
  systems,
}) => {
  const getRoute = usePluginRoute();
  const accessApi = useApi(accessApiRef);
  const { allowed: canManage } = accessApi.useAccess(maintenanceAccess.maintenance.manage);

  const systemMap = new Map(systems.map((s) => [s.id, s.name]));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader className="flex flex-row items-start justify-between gap-4 pt-6">
          <div className="flex flex-col gap-1 text-left">
            <SheetTitle>Active & Scheduled Maintenances</SheetTitle>
            <p className="text-sm text-muted-foreground">
              Overview of scheduled and ongoing windows
            </p>
          </div>
          {canManage && (
            <Button variant="outline" size="sm" asChild>
              <Link to={getRoute(maintenanceRoutes.routes.config)}>Manage</Link>
            </Button>
          )}
        </SheetHeader>

        <SheetBody className="flex flex-col gap-3 pb-8">
          {maintenances.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No active maintenances
            </p>
          ) : (
            maintenances.map((maintenance) => {
              const affectedSystemNames = maintenance.systemIds
                .map((id) => systemMap.get(id) || id)
                .join(", ");

              const badgeVariant = 
                maintenance.status === "in_progress"
                  ? "warning"
                  : maintenance.status === "scheduled"
                    ? "info"
                    : maintenance.status === "completed"
                      ? "success"
                      : "secondary";

              return (
                <Link
                  key={maintenance.id}
                  to={resolveRoute(maintenanceRoutes.routes.detail, { maintenanceId: maintenance.id })}
                  onClick={() => onOpenChange(false)}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 hover:border-primary/50 hover:shadow-sm transition-all text-left"
                >
                  <div className="flex items-start justify-between gap-4">
                    <h4 className="font-medium text-foreground">
                      {maintenance.title}
                    </h4>
                    <Badge variant={badgeVariant} className="capitalize flex-shrink-0">
                      {maintenance.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-1 mt-2">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Affected Systems
                    </span>
                    <span className="text-sm text-foreground">
                      {affectedSystemNames || "None"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 mt-2">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Schedule
                    </span>
                    <span className="text-sm text-foreground">
                      {new Date(maintenance.startAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {" - "}
                      {new Date(maintenance.endAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </Link>
              );
            })
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
};
